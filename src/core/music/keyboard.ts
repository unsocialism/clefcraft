import { PIANO_HIGHEST, PIANO_LOWEST, isBlackKey } from './pitch.ts';

/**
 * Geometry for drawing a piano keyboard, in white-key units.
 *
 * Kept free of the DOM so the layout can be unit-tested and reused by any
 * renderer (SVG today, a canvas or a native view later). Multiply every `x`
 * and `width` by a pixel-per-white-key figure at draw time.
 */

export interface KeyRect {
  readonly midi: number;
  readonly black: boolean;
  /** Left edge, in white-key widths from the left end of the keyboard. */
  readonly x: number;
  /** Width, in white-key widths. */
  readonly width: number;
  /** Height as a fraction of the full key height. */
  readonly height: number;
}

export interface KeyboardLayout {
  readonly lowest: number;
  readonly highest: number;
  /** Total keyboard width in white-key widths. */
  readonly width: number;
  /** Draw these first. */
  readonly whiteKeys: readonly KeyRect[];
  /** Draw these on top. */
  readonly blackKeys: readonly KeyRect[];
}

const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export const BLACK_KEY_WIDTH = 0.58;
export const BLACK_KEY_HEIGHT = 0.62;

/**
 * Centre of each black key, in white-key widths from the C of its octave.
 *
 * Not simply the midpoint between its neighbours: on a real piano the three
 * keys of the C-D-E group and the four of the F-G-A-B group are nudged apart
 * so the white keys behind them stay equal width.
 */
const BLACK_KEY_CENTRE: Readonly<Record<number, number>> = {
  1: 0.9, // C#
  3: 2.1, // D#
  6: 3.9, // F#
  8: 5.0, // G#
  10: 6.1, // A#
};

function isWhite(midi: number): boolean {
  return WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/**
 * Signed index of the white key at `midi`, counting from `lowest`.
 * Negative when `midi` sits below the left end of the keyboard, which happens
 * for the C that anchors a black key on an 88-key board starting at A0.
 */
function whiteIndexAt(midi: number, lowest: number): number {
  if (midi >= lowest) {
    let count = 0;
    for (let m = lowest; m < midi; m++) if (isWhite(m)) count++;
    return count;
  }
  let count = 0;
  for (let m = midi; m < lowest; m++) if (isWhite(m)) count++;
  return -count;
}

/**
 * Build the layout for a key range. Defaults to a full 88-key board, A0 to C8.
 * The range is widened to start and end on white keys so the board has square
 * ends, exactly as a real instrument does.
 */
export function keyboardLayout(
  lowest: number = PIANO_LOWEST,
  highest: number = PIANO_HIGHEST,
): KeyboardLayout {
  let lo = lowest;
  let hi = highest;
  while (lo < hi && !isWhite(lo)) lo--;
  while (hi > lo && !isWhite(hi)) hi++;

  const whiteKeys: KeyRect[] = [];
  const blackKeys: KeyRect[] = [];

  for (let midi = lo; midi <= hi; midi++) {
    if (isWhite(midi)) {
      whiteKeys.push({
        midi,
        black: false,
        x: whiteIndexAt(midi, lo),
        width: 1,
        height: 1,
      });
    } else {
      const pitchClass = ((midi % 12) + 12) % 12;
      const octaveC = midi - pitchClass;
      const centre = whiteIndexAt(octaveC, lo) + (BLACK_KEY_CENTRE[pitchClass] ?? 0);
      blackKeys.push({
        midi,
        black: true,
        x: centre - BLACK_KEY_WIDTH / 2,
        width: BLACK_KEY_WIDTH,
        height: BLACK_KEY_HEIGHT,
      });
    }
  }

  return { lowest: lo, highest: hi, width: whiteKeys.length, whiteKeys, blackKeys };
}

/** Convenience re-export so UI code can ask one module about key colour. */
export { isBlackKey };
