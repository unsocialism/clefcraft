import { useEffect, useRef } from 'react';

import { keyboardLayout } from '../core/music/keyboard.ts';
import { verdictOf, type Judged, type LiveNote } from '../core/midi/trail.ts';
import { stepEase, visibleAt, type FallingScore } from '../core/score/fallingNotes.ts';

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
 *
 * Only the backward-looking strip is measured this way. The one that shows
 * what is coming is measured in beats, because what matters there is how
 * much music you can see, not how many pixels a second go by.
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

/**
 * The hands, in the palette the keyboard guides and the sheet already use:
 * blue for the right, amber for the left. A falling bar is the same colour
 * as the key it is going to land on lights up, which is what makes the two
 * read as one picture rather than two.
 */
const HAND_WHITE: Record<string, string> = { right: '47, 109, 246', left: '240, 140, 0' };
const HAND_BLACK: Record<string, string> = { right: '28, 79, 196', left: '181, 104, 0' };
/** A note already under your finger, one still on its way, and one that is not yours. */
const NOW_ALPHA = 0.95;
const SOON_ALPHA = 0.8;
const OTHER_HAND_ALPHA = 0.2;
/** The band at the top a note fades in over, as a fraction of the strip. */
const FADE_IN = 0.16;
/** The rules across the strip: one a beat, brighter on the barline. */
const BEAT_RULE = 'rgba(15, 23, 42, 0.07)';
const BAR_RULE = 'rgba(15, 23, 42, 0.16)';

/** Where the music is, and whether anything is moving it along. */
export interface RollPosition {
  /** Musical position, in quarter notes from the start of the piece. */
  readonly quarters: number;
  /** True while a clock is advancing it, so the strip has to animate. */
  readonly moving: boolean;
}

/** What the strip needs to show the music coming rather than the music gone. */
export interface FallingView {
  readonly score: FallingScore;
  /** Read every frame: a press must not restart the animation. */
  readonly position: () => RollPosition;
  /** How much music the strip holds, top to bottom. */
  readonly leadQuarters: number;
  readonly beatQuarters: number;
  readonly beatsPerBar: number;
}

export interface PianoRollProps {
  /** Live notes, read every frame rather than passed as state. */
  readonly notes: { readonly current: readonly LiveNote[] };
  /**
   * What the practice engine made of the last few presses, where something
   * is judging them. Empty in free play, where a note is just a note.
   */
  readonly verdicts?: readonly Judged[];
  /**
   * Given, the strip turns round: it shows the notes still to play, falling
   * towards their keys, instead of the ones just played rising off them.
   */
  readonly falling?: FallingView;
  readonly lowest?: number;
  readonly highest?: number;
  /** Stop the animation when nothing can see it. */
  readonly running?: boolean;
}

/**
 * The strip above the keys.
 *
 * It runs one of two ways round. Left alone it shows what you played: a note
 * appears at the keyboard the moment it is struck, grows while the key is
 * held, and drifts up and off the top a second or so later — which says what
 * notation cannot, how long you held each key and how evenly the notes fell.
 * Given a score to look ahead in, it runs the other way: the notes to come
 * fall towards the keys they belong to and reach them at the moment they are
 * due. Practice uses the second, because a strip of what you have already
 * done is a strip you can do nothing about; free play has no score to look
 * ahead in and keeps the first.
 *
 * Drawn on a canvas rather than as elements. There is no state to keep
 * between frames — every frame is the same notes drawn against a later
 * clock — and a canvas does that in one pass, where fifty rectangles of DOM
 * updated sixty times a second is work the browser has to undo again.
 */
export function PianoRoll({
  notes,
  verdicts = [],
  falling,
  lowest,
  highest,
  running = true,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read every frame, so a press does not restart the animation loop.
  const verdictsRef = useRef(verdicts);
  verdictsRef.current = verdicts;
  // The same, and for the same reason: the cursor moves on every note, and
  // the effect below must not be torn down and rebuilt each time it does.
  const fallingRef = useRef(falling);
  fallingRef.current = falling;
  // The engine remembers only the last few presses, and a note is on screen
  // longer than that in a quick passage. So a verdict is kept once seen: a
  // note that turned green must not turn blue again as it rises. Keyed by
  // the note's own start, because ids begin again when the trail is cleared.
  const seen = useRef(new Map<string, string>());

  const looksAhead = falling !== undefined;

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

    /**
     * The keys themselves, to take the mapping from.
     *
     * Working it out a second time here is what put the notes out of line:
     * the keyboard's SVG fits its drawing to its box with
     * preserveAspectRatio, which means the *height* decides the scale as
     * soon as the box is wider than it is tall enough for — a phone in
     * landscape, a short window — and a copy of the formula that only knew
     * about width drifted by tens of pixels towards the ends. Asking the
     * element for its own matrix cannot drift.
     */
    const keyboard = canvas.parentElement?.querySelector('svg.keyboard') as SVGSVGElement | null;

    // Where the strip has got to, and the step it is part way through. Wait
    // mode has no clock of its own, so a note played moves the cursor and the
    // strip eases after it rather than flicking to the new position.
    let shown = fallingRef.current?.position().quarters ?? 0;
    let stepFrom = shown;
    let stepTo = shown;
    let stepAt = performance.now();

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

      // Straight from the keyboard's own transform, so a note sits over its
      // key at every size. The fallback is the shape of that transform when
      // there is no keyboard to ask, which in this app there always is.
      const matrix = keyboard?.getScreenCTM();
      let scale = Math.min(width / drawnWidth, 1);
      let offset = (width - drawnWidth * scale) / 2;
      if (matrix && matrix.a > 0) {
        scale = matrix.a;
        offset = matrix.e - canvas.getBoundingClientRect().left;
      }
      /** Where a key's bar sits and how wide it is. */
      const columnOf = (midi: number) => {
        const key = keys.get(midi);
        if (!key) return null;
        return {
          black: key.black,
          x: offset + key.x * WHITE_KEY_PX * scale,
          wide: Math.max(2, key.width * WHITE_KEY_PX * scale - 1),
        };
      };
      /** A rounded bar, square-cornered where the browser has no roundRect. */
      const bar = (x: number, y: number, wide: number, tall: number) => {
        const radius = Math.min(4, wide / 2, tall / 2);
        context.beginPath();
        const rounded = context as CanvasRenderingContext2D & {
          roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
        };
        if (typeof rounded.roundRect === 'function') rounded.roundRect(x, y, wide, tall, radius);
        else context.rect(x, y, wide, tall);
        context.fill();
      };

      const ahead = fallingRef.current;
      const now = performance.now();
      let drawing = false;

      if (ahead) {
        /*
         * Looking ahead. The strip is a window on to the score: the keyboard
         * edge is *now*, the top is `leadQuarters` of music away, and a note
         * is a bar standing between its onset and its release. A note being
         * held has its foot on the keyboard and its head in the window,
         * which is exactly what a held key looks like.
         */
        const target = ahead.position();
        if (target.moving) {
          // A clock is driving it: follow, and leave nothing half-stepped
          // behind for when the clock stops again.
          shown = target.quarters;
          stepFrom = shown;
          stepTo = shown;
        } else {
          if (target.quarters !== stepTo) {
            stepFrom = shown;
            stepTo = target.quarters;
            stepAt = now;
          }
          shown = stepEase(stepFrom, stepTo, now - stepAt);
        }

        const lead = Math.max(1e-6, ahead.leadQuarters);
        /** Musical position to a y on the strip: `shown` is the bottom edge. */
        const yOf = (quarters: number) => height * (1 - (quarters - shown) / lead);

        // The beats, so the strip can be read as rhythm and not just as
        // distance. The barline is the one worth finding at a glance.
        const beat = Math.max(1e-6, ahead.beatQuarters);
        const barQuarters = beat * Math.max(1, Math.round(ahead.beatsPerBar));
        const firstBeat = Math.ceil((shown - 1e-9) / beat) * beat;
        for (let q = firstBeat; q < shown + lead; q += beat) {
          const onBar = Math.abs(q / barQuarters - Math.round(q / barQuarters)) < 1e-6;
          context.fillStyle = onBar ? BAR_RULE : BEAT_RULE;
          context.fillRect(0, Math.round(yOf(q)), width, 1);
        }

        for (const note of visibleAt(ahead.score, shown, lead)) {
          const column = columnOf(note.midi);
          if (!column) continue;
          const top = Math.max(0, yOf(note.endQuarters));
          const bottom = Math.min(height, yOf(note.startQuarters));
          const tall = Math.max(2, bottom - top);
          // Fading in at the top rather than appearing there: a note that
          // simply existed from one frame to the next reads as a glitch.
          const fade = Math.min(1, bottom / (height * FADE_IN));
          const struck = note.startQuarters <= shown;
          const alpha =
            (note.expected ? (struck ? NOW_ALPHA : SOON_ALPHA) : OTHER_HAND_ALPHA) * fade;
          const colour = (column.black ? HAND_BLACK : HAND_WHITE)[note.hand] ?? PLAIN_WHITE;
          context.fillStyle = `rgba(${colour}, ${alpha.toFixed(3)})`;
          bar(column.x, top, column.wide, tall);
        }

        // Something is always worth drawing while the clock runs; while it
        // does not, only the glide needs frames of its own.
        drawing = target.moving || shown !== stepTo;
      } else {
        const perMs = PIXELS_PER_SECOND / 1000;
        const judged = verdictsRef.current;
        const kept = seen.current;
        const live = new Set<string>();

        for (const note of notes.current) {
          const column = columnOf(note.midi);
          if (!column) continue;
          const endMs = note.endMs ?? now;
          const top = height - (now - note.startMs) * perMs;
          const bottom = height - (now - endMs) * perMs;
          if (bottom < 0) continue; // risen off the top
          drawing = true;
          const y = Math.max(0, top);
          const tall = Math.max(2, Math.min(height, bottom) - y);

          const id = `${note.id}:${note.startMs}`;
          live.add(id);
          const verdict = kept.get(id) ?? verdictOf(note, judged);
          if (verdict && !kept.has(id)) kept.set(id, verdict);

          // Fading with height rather than clipping: a note that simply
          // vanished at the top would read as an edit.
          const fade = Math.max(0, Math.min(1, (y + tall) / height));
          const strength = 0.35 + (note.velocity / 127) * 0.5;
          const colour =
            (verdict ? COLOURS[verdict] : undefined) ??
            (column.black ? PLAIN_BLACK : PLAIN_WHITE);
          // A wrong note is worth seeing from across the room; a right one
          // only needs to be legible. Velocity still shades both.
          const alpha = Math.min(0.95, strength * (EMPHASIS[verdict ?? ''] ?? 1) * fade);
          context.fillStyle = `rgba(${colour}, ${alpha.toFixed(3)})`;
          bar(column.x, y, column.wide, tall);
        }

        // Forget notes that have left the strip, so the cache cannot grow
        // through a long session.
        if (kept.size > live.size) {
          for (const id of kept.keys()) if (!live.has(id)) kept.delete(id);
        }
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
  }, [notes, lowest, highest, running, looksAhead]);

  return (
    <canvas
      ref={canvasRef}
      className={looksAhead ? 'piano-roll piano-roll--ahead' : 'piano-roll'}
      aria-hidden="true"
    />
  );
}
