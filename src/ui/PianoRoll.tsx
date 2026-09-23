import { useEffect, useRef } from 'react';

import { keyboardLayout } from '../core/music/keyboard.ts';
import type { LiveNote } from '../core/midi/trail.ts';

/** Must match the keyboard's own white-key width, or nothing lines up. */
const WHITE_KEY_PX = 26;
/** How tall the strip is when the stylesheet has not said. */
const FALLBACK_HEIGHT_PX = 104;
/** How many seconds of playing the strip holds. */
const SECONDS = 5;
/** How often to look again while there is nothing to animate. */
const IDLE_MS = 120;

export interface PianoRollProps {
  /** Live notes, read every frame rather than passed as state. */
  readonly notes: { readonly current: readonly LiveNote[] };
  readonly lowest?: number;
  readonly highest?: number;
  /** Stop the animation when nothing can see it. */
  readonly running?: boolean;
}

/**
 * What you played, rising off the keys.
 *
 * A note appears at the keyboard the moment it is struck, grows while the
 * key is held, and drifts upwards until it leaves the strip about five
 * seconds later. It says what notation cannot: how long you held each key
 * and how evenly the notes fell.
 *
 * Drawn on a canvas rather than as elements. There is no state to keep
 * between frames — every frame is the same notes drawn against a later
 * clock — and a canvas does that in one pass, where fifty rectangles of DOM
 * updated sixty times a second is work the browser has to undo again.
 */
export function PianoRoll({ notes, lowest, highest, running = true }: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
      const perMs = height / (SECONDS * 1000);
      const now = performance.now();
      let drawing = false;

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

        // Fading with height rather than clipping: a note that simply
        // vanished at the top would read as an edit.
        const fade = Math.max(0, Math.min(1, (y + tall) / height));
        const strength = 0.35 + (note.velocity / 127) * 0.5;
        context.fillStyle = key.black
          ? `rgba(30, 64, 175, ${(strength * fade).toFixed(3)})`
          : `rgba(47, 109, 246, ${(strength * fade).toFixed(3)})`;
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
