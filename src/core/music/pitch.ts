import { NATURAL_PITCH_CLASS, STEPS, keyAlterations, type Step } from './keySignature.ts';

export type Alter = -1 | 0 | 1;

/** A MIDI number turned into something writable on a staff. */
export interface SpelledNote {
  readonly midi: number;
  readonly step: Step;
  readonly alter: Alter;
  /** Scientific pitch notation octave, derived from the *spelling*: C♭4 is MIDI 59. */
  readonly octave: number;
}

export type AccidentalPreference = 'auto' | 'sharps' | 'flats';

/** MIDI 60 is middle C = C4 (scientific pitch notation). */
export const MIDDLE_C = 60;
/** An 88-key piano runs A0 (21) to C8 (108). */
export const PIANO_LOWEST = 21;
export const PIANO_HIGHEST = 108;

function accidentalGlyph(alter: Alter): string {
  return alter === 1 ? '♯' : alter === -1 ? '♭' : '';
}

/** VexFlow and MusicXML-style ASCII, e.g. "bb/3", "c#/4". */
function accidentalAscii(alter: Alter): string {
  return alter === 1 ? '#' : alter === -1 ? 'b' : '';
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/**
 * Score a candidate spelling for a pitch class in a given key. Lower is better.
 *
 *   0  the letter's spelling in this key signature (a diatonic note)
 *   1  a natural that the key signature alters — e.g. B♮ in F major, which is
 *      what a raised 4th actually looks like, not C♭
 *   2  an accidental in the direction the key leans (♯ in sharp keys)
 *   3  an accidental against the key's lean
 *
 * This ordering is why F major spells MIDI 71 as B♮ rather than C♭, and why
 * E♭ major spells MIDI 6 as G♭ rather than F♯.
 */
function score(alter: Alter, keyAlter: Alter, prefersSharps: boolean): number {
  if (alter === keyAlter) return 0;
  if (alter === 0) return 1;
  const leaning: Alter = prefersSharps ? 1 : -1;
  return alter === leaning ? 2 : 3;
}

/**
 * Choose how to write a MIDI pitch in a given key.
 *
 * Only single accidentals are considered: double sharps and double flats are
 * correct in some harmonic contexts but need harmony we do not have from a
 * bare stream of note-ons.
 */
export function spellNote(
  midi: number,
  fifths = 0,
  preference: AccidentalPreference = 'auto',
): SpelledNote {
  const pitchClass = mod12(midi);
  const alterations = keyAlterations(fifths);
  const prefersSharps = preference === 'auto' ? fifths >= 0 : preference === 'sharps';

  // Every pitch class has at least one single-accidental spelling, so these
  // defaults are always overwritten; they exist to satisfy the type checker.
  let bestStep: Step = 'C';
  let bestAlter: Alter = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const step of STEPS) {
    const natural = NATURAL_PITCH_CLASS[step];
    for (const alter of [0, 1, -1] as const) {
      if (mod12(natural + alter) !== pitchClass) continue;
      const candidateScore = score(alter, alterations[step], prefersSharps);
      if (candidateScore < bestScore) {
        bestStep = step;
        bestAlter = alter;
        bestScore = candidateScore;
      }
    }
  }

  // Derive the octave from the spelling, not from the MIDI number, so that
  // C♭4 (MIDI 59) and B♯3 (MIDI 60) land on the right staff line.
  const octave = (midi - bestAlter - NATURAL_PITCH_CLASS[bestStep]) / 12 - 1;

  return { midi, step: bestStep, alter: bestAlter, octave };
}

/** Human-readable name with a real accidental glyph, e.g. "F♯4". */
export function noteName(note: SpelledNote): string {
  return `${note.step}${accidentalGlyph(note.alter)}${note.octave}`;
}

/** Name without the octave, e.g. "F♯". */
export function pitchClassName(note: SpelledNote): string {
  return `${note.step}${accidentalGlyph(note.alter)}`;
}

/** The `"c#/4"` form VexFlow's StaveNote wants. */
export function vexflowKey(note: SpelledNote): string {
  return `${note.step.toLowerCase()}${accidentalAscii(note.alter)}/${note.octave}`;
}

/** The accidental code VexFlow's `Accidental` wants, or null for a natural. */
export function vexflowAccidental(note: SpelledNote, fifths: number): string | null {
  const alterations = keyAlterations(fifths);
  const keyAlter = alterations[note.step];
  if (note.alter === keyAlter) return null; // already implied by the key signature
  if (note.alter === 1) return '#';
  if (note.alter === -1) return 'b';
  return 'n'; // a natural that cancels the key signature
}

/** True for the five pitch classes that sit on a black key. */
export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(mod12(midi));
}

/** Frequency in Hz at A4 = 440, handy for a tuner or a fallback synth. */
export function frequencyOf(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}
