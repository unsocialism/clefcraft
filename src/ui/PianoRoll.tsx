import { useEffect, useRef } from 'react';

import { keyboardLayout } from '../core/music/keyboard.ts';
import { verdictOf, type Judged, type LiveNote } from '../core/midi/trail.ts';

/** Must match the keyboard's own white-key width, or nothing lines up. */
const WHITE_KEY_PX = 26;
/** How tall the strip is when the stylesheet has not said. */
const FALLBACK_HEIGHT_PX = 104;
/**
 * How fast a note travels up the strip, in pixels a second.
 *
 * Set as a speed rather than as "so many seconds of history", so the
 * animation feels the same on a tall strip and on the short one a phone in
 * landscape gets — the short one simply holds less of the past.
 *
 * Pitched so that an ordinary note fills an obvious part of the strip: a
 * key held half a second draws half of it, and one held for a second and a
 * bit fills it. Slower than this and notes of the length people actually
 * play were a sliver at the bottom, which told you nothing. The price is
 * how much of the past is on screen — a little over a second at full
 * height — and that is the right way round: the strip is for how you are
 * playing now, and the staff above it is what remembers.
 */
const PIXELS_PER_SECOND = 88;
/** How often to look again while there is nothing to animate. */
const IDLE_MS = 120;

/**
 * A note's colour, by what the exercise or the score made of it. Written as
 * numbers rather than CSS variables because a canvas cannot read the
 * stylesheet; they are the palette's own values.
 */
const COLOURS: Record<string, string> = {
  correct: '31, 157, 85', // --ok
  restarted: '194, 65, 12', // --warn: the right note, but not in time
  wrong: '208, 52, 44',
};
/** Free play judges nothing, and neither does a repeated key of a chord. */
const PLAIN_WHITE = '47, 109, 246';
const PLAIN_BLACK = '30, 64, 175';
/** How much louder a judged note is drawn than a plain one. */
const EMPHASIS: Record<string, number> = { wrong: 1.5, restarted: 1.35, correct: 1.2 };

export interface PianoRollProps {
  /** Live notes, read every frame rather than passed as state. */
  readonly notes: { readonly current: readonly LiveNote[] };
  /**
   * What the practice engine made of the last few presses, where something
   * is judging them. Empty in free play, where a note is just a note.
   */
  readonly verdicts?: readonly Judged[];
  readonly lowest?: number;
  readonly highest?: number;
  /** Stop the animation when nothing can see it. */
  readonly running?: boolean;
}

/**
 * What you played, rising off the keys.
 *
 * A note appears at the keyboard the moment it is struck, grows while the
 * key is held, and drifts up and off the top a second or so later. It says
 * what notation cannot: how long you held each key and how evenly the notes
 * fell.
 *
 * Drawn on a canvas rather than as elements. There is no state to keep
 * between frames — every frame is the same notes drawn against a later
 * clock — and a canvas does that in one pass, where fifty rectangles of DOM
 * updated sixty times a second is work the browser has to undo again.
 */
export function PianoRoll({
  notes,
  verdicts = [],
  lowest,
  highest,
  running = true,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read every frame, so a press does not restart the animation loop.
  const verdictsRef = useRef(verdicts);
  verdictsRef.current = verdicts;
  // The engine remembers only the last few presses, and a note is on screen
  // longer than that in a quick passage. So a verdict is kept once seen: a
  // note that turned green must not turn blue again as it rises. Keyed by
  // the note's own start, because ids begin again when the trail is cleared.
  const seen = useRef(new Map<string, string>());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const layout = keyboardLayout(lowest, highest);
    const drawnWidth = layout.width * WHITE_KEY_PX;
    const keys = new Map(
      [...layout.whiteKeys, ...layout.blackKeys].map((key) => [key.midi, key] as const),
    );

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (loop: boolean) => {
      const width = canvas.clientWidth;
      // Read from the element, so the stylesheet can give a short screen a
      // shorter strip without this having to know about screens.
      const height = canvas.clientHeight || FALLBACK_HEIGHT_PX;
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      // The same scaling the keyboard's SVG does with
      // preserveAspectRatio="xMidYMid meet", so a note sits over its key at
      // every width.
      const scale = Math.min(width / drawnWidth, 1);
      const offset = (width - drawnWidth * scale) / 2;
      const perMs = PIXELS_PER_SECOND / 1000;
      const now = performance.now();
      let drawing = false;

      const judged = verdictsRef.current;
      const kept = seen.current;
      const live = new Set<string>();

      for (const note of notes.current) {
        const key = keys.get(note.midi);
        if (!key) continue;
        const endMs = note.endMs ?? now;
        const top = height - (now - note.startMs) * perMs;
        const bottom = height - (now - endMs) * perMs;
        if (bottom < 0) continue; // risen off the top
        drawing = true;
        const y = Math.max(0, top);
        const tall = Math.max(2, Math.min(height, bottom) - y);
        const x = offset + key.x * WHITE_KEY_PX * scale;
        const wide = Math.max(2, key.width * WHITE_KEY_PX * scale - 1);

        const id = `${note.id}:${note.startMs}`;
        live.add(id);
        const verdict = kept.get(id) ?? verdictOf(note, judged);
        if (verdict && !kept.has(id)) kept.set(id, verdict);

        // Fading with height rather than clipping: a note that simply
        // vanished at the top would read as an edit.
        const fade = Math.max(0, Math.min(1, (y + tall) / height));
        const strength = 0.35 + (note.velocity / 127) * 0.5;
        const colour =
          (verdict ? COLOURS[verdict] : undefined) ?? (key.black ? PLAIN_BLACK : PLAIN_WHITE);
        // A wrong note is worth seeing from across the room; a right one
        // only needs to be legible. Velocity still shades both.
        const alpha = Math.min(0.95, strength * (EMPHASIS[verdict ?? ''] ?? 1) * fade);
        context.fillStyle = `rgba(${colour}, ${alpha.toFixed(3)})`;
        const radius = Math.min(4, wide / 2, tall / 2);
        context.beginPath();
        // Rounded corners where the browser has them; square is no tragedy.
        const rounded = context as CanvasRenderingContext2D & {
          roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
        };
        if (typeof rounded.roundRect === 'function') rounded.roundRect(x, y, wide, tall, radius);
        else context.rect(x, y, wide, tall);
        context.fill();
      }

      // Forget notes that have left the strip, so the cache cannot grow
      // through a long session.
      if (kept.size > live.size) {
        for (const id of kept.keys()) if (!live.has(id)) kept.delete(id);
      }

      if (!loop) return;
      // Nothing on screen and nothing being held: there is no animation to
      // run, so look again in a moment rather than sixty times a second.
      // Free play is where a phone sits idle with the app open.
      if (drawing) frame = requestAnimationFrame(() => draw(true));
      else timer = setTimeout(() => draw(true), IDLE_MS);
    };

    draw(running);
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [notes, lowest, highest, running]);

  return (
    <canvas ref={canvasRef} className="piano-roll" aria-hidden="true" />
  );
}
