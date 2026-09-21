/** Diatonic letter names, in the order the staff stacks them. */
export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Step = (typeof STEPS)[number];

/** Pitch class of each natural letter. */
export const NATURAL_PITCH_CLASS: Readonly<Record<Step, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** Order accidentals are added to a key signature. */
const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export interface KeySignature {
  /** Display name, e.g. "E♭ major". */
  readonly name: string;
  /** Positive = that many sharps, negative = that many flats, 0 = C major. */
  readonly fifths: number;
  /** The string VexFlow's `addKeySignature` expects, e.g. "Eb". */
  readonly vexflow: string;
}

/** Major keys from 7 flats to 7 sharps. */
export const KEY_SIGNATURES: readonly KeySignature[] = [
  { name: 'C♭ major', fifths: -7, vexflow: 'Cb' },
  { name: 'G♭ major', fifths: -6, vexflow: 'Gb' },
  { name: 'D♭ major', fifths: -5, vexflow: 'Db' },
  { name: 'A♭ major', fifths: -4, vexflow: 'Ab' },
  { name: 'E♭ major', fifths: -3, vexflow: 'Eb' },
  { name: 'B♭ major', fifths: -2, vexflow: 'Bb' },
  { name: 'F major', fifths: -1, vexflow: 'F' },
  { name: 'C major', fifths: 0, vexflow: 'C' },
  { name: 'G major', fifths: 1, vexflow: 'G' },
  { name: 'D major', fifths: 2, vexflow: 'D' },
  { name: 'A major', fifths: 3, vexflow: 'A' },
  { name: 'E major', fifths: 4, vexflow: 'E' },
  { name: 'B major', fifths: 5, vexflow: 'B' },
  { name: 'F♯ major', fifths: 6, vexflow: 'F#' },
  { name: 'C♯ major', fifths: 7, vexflow: 'C#' },
];

export const C_MAJOR: KeySignature = KEY_SIGNATURES.find((k) => k.fifths === 0)!;

export function keySignatureByFifths(fifths: number): KeySignature {
  return KEY_SIGNATURES.find((k) => k.fifths === fifths) ?? C_MAJOR;
}

/**
 * The accidental the key signature applies to each letter: -1, 0 or +1.
 * F♯ major, for instance, gives every letter but B a +1.
 */
export function keyAlterations(fifths: number): Record<Step, -1 | 0 | 1> {
  const alterations: Record<Step, -1 | 0 | 1> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const count = Math.min(Math.abs(fifths), 7);
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  const value: -1 | 1 = fifths >= 0 ? 1 : -1;
  for (let i = 0; i < count; i++) {
    const step = order[i];
    if (step) alterations[step] = value;
  }
  return alterations;
}
