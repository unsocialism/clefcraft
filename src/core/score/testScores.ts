import type { Score, ScoreEvent, ScoreNote } from './types.ts';

/**
 * Score builders shared by the unit tests and the in-app demo score, so the
 * thing the tests exercise is the thing the app renders.
 */

export interface EventSpec {
  /** MIDI numbers struck at this moment. A number alone means staff 1. */
  readonly notes: readonly (number | { midi: number; staff?: number; tied?: boolean })[];
  readonly measure?: number;
  /** Length in quarter notes. Defaults to 1. */
  readonly duration?: number;
}

export function buildScore(
  specs: readonly EventSpec[],
  options: { title?: string; tempoBpm?: number | null } = {},
): Score {
  let onset = 0;
  const events: ScoreEvent[] = specs.map((spec, index) => {
    const duration = spec.duration ?? 1;
    const notes: ScoreNote[] = spec.notes.map((note) =>
      typeof note === 'number'
        ? { midi: note, staff: 1, tiedFromPrevious: false }
        : { midi: note.midi, staff: note.staff ?? 1, tiedFromPrevious: note.tied ?? false },
    );
    const event: ScoreEvent = {
      index,
      notes,
      measure: spec.measure ?? Math.floor(onset / 4) + 1,
      onsetQuarters: onset,
      durationQuarters: duration,
      cursorIndex: index,
    };
    onset += duration;
    return event;
  });

  return {
    title: options.title ?? 'Untitled',
    events,
    tempoBpm: options.tempoBpm ?? null,
    measureCount: events.reduce((max, event) => Math.max(max, event.measure), 0),
    source: 'test',
  };
}

/** A C major scale, right hand, one note per quarter. */
export const C_MAJOR_SCALE: Score = buildScore(
  [60, 62, 64, 65, 67, 69, 71, 72].map((midi) => ({ notes: [midi] })),
  { title: 'C major scale', tempoBpm: 80 },
);

/** Two hands, chords against a bass line — the shape a real piece has. */
export const TWO_HAND_DEMO: Score = buildScore(
  [
    { notes: [{ midi: 36, staff: 2 }, { midi: 60 }, { midi: 64 }, { midi: 67 }], duration: 2 },
    { notes: [{ midi: 43, staff: 2 }, { midi: 65 }, { midi: 69 }], duration: 2 },
    { notes: [{ midi: 41, staff: 2 }, { midi: 62 }, { midi: 65 }, { midi: 71 }], duration: 2 },
    { notes: [{ midi: 36, staff: 2 }, { midi: 60 }, { midi: 64 }, { midi: 67 }], duration: 2 },
  ],
  { title: 'Two-hand demo', tempoBpm: 72 },
);
