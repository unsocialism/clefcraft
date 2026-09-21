import {
  MIDDLE_C,
  spellNote,
  vexflowAccidental,
  vexflowKey,
  type AccidentalPreference,
  type SpelledNote,
} from './pitch.ts';

export type Clef = 'treble' | 'bass';

export interface StaffNote {
  readonly spelled: SpelledNote;
  readonly clef: Clef;
  /** VexFlow key string, e.g. "eb/4". */
  readonly key: string;
  /** VexFlow accidental code ("#", "b", "n") or null when the key signature covers it. */
  readonly accidental: string | null;
}

export interface StaffLayoutOptions {
  /** Key signature as a count of sharps (positive) or flats (negative). */
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
  /** Lowest MIDI note drawn on the treble stave. Middle C by default. */
  readonly splitPoint?: number;
}

export interface GrandStaffNotes {
  readonly treble: readonly StaffNote[];
  readonly bass: readonly StaffNote[];
}

/**
 * Which stave a pitch belongs on.
 *
 * A fixed split at middle C is the convention for a note-reading display. It
 * is deliberately not "which hand played it" — MIDI does not tell us that,
 * and guessing from timing produces a staff that jumps around while you play.
 */
export function assignClef(midi: number, splitPoint: number = MIDDLE_C): Clef {
  return midi >= splitPoint ? 'treble' : 'bass';
}

/** Turn the sounding MIDI notes into per-clef, VexFlow-ready note descriptions. */
export function toGrandStaffNotes(
  midiNotes: readonly number[],
  options: StaffLayoutOptions = {},
): GrandStaffNotes {
  const { fifths = 0, accidentals = 'auto', splitPoint = MIDDLE_C } = options;

  const treble: StaffNote[] = [];
  const bass: StaffNote[] = [];

  for (const midi of [...midiNotes].sort((a, b) => a - b)) {
    const spelled = spellNote(midi, fifths, accidentals);
    const clef = assignClef(midi, splitPoint);
    const note: StaffNote = {
      spelled,
      clef,
      key: vexflowKey(spelled),
      accidental: vexflowAccidental(spelled, fifths),
    };
    (clef === 'treble' ? treble : bass).push(note);
  }

  return { treble, bass };
}
