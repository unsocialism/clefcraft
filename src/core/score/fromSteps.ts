import type { Score, ScoreEvent, ScoreNote } from './types.ts';

/**
 * One position of a score cursor, in the most neutral form possible.
 *
 * The OSMD adapter produces these and so, later, will the PDF extractor.
 * Everything downstream — durations, rest handling, measure numbering — is
 * computed here, where it can be tested without a renderer.
 */
export interface CursorStep {
  /** Position in the source cursor's step sequence, rests included. */
  readonly cursorIndex: number;
  /** Onset from the start of the piece, in quarter notes. */
  readonly onsetQuarters: number;
  /** Printed measure number. */
  readonly measure: number;
  readonly notes: readonly {
    readonly midi: number;
    readonly staff: number;
    readonly tiedFromPrevious: boolean;
    /** Length of this note in quarter notes, when known. */
    readonly lengthQuarters?: number;
  }[];
}

export interface BuildScoreOptions {
  readonly title?: string;
  readonly tempoBpm?: number | null;
  readonly source?: Score['source'];
}

/**
 * Turn cursor steps into a Score.
 *
 * Steps with no notes (rests) are dropped, but their time is not: the event
 * before a rest keeps its real length, so tempo mode waits through the rest
 * instead of racing ahead.
 */
export function buildScoreFromSteps(
  steps: readonly CursorStep[],
  options: BuildScoreOptions = {},
): Score {
  const sorted = [...steps].sort((a, b) => a.onsetQuarters - b.onsetQuarters);

  // Merge steps that land on the same onset — a cursor can report the two
  // staves of a grand staff separately.
  const merged: CursorStep[] = [];
  for (const step of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.onsetQuarters - step.onsetQuarters) < 1e-9) {
      merged[merged.length - 1] = {
        cursorIndex: Math.min(previous.cursorIndex, step.cursorIndex),
        onsetQuarters: previous.onsetQuarters,
        measure: Math.min(previous.measure, step.measure),
        notes: [...previous.notes, ...step.notes],
      };
    } else {
      merged.push(step);
    }
  }

  const sounding = merged.filter((step) => step.notes.length > 0);

  const events: ScoreEvent[] = sounding.map((step, index) => {
    const next = sounding[index + 1];
    // Prefer the gap to the next event; fall back to the longest note here so
    // the final event still has a length.
    const longestNote = step.notes.reduce(
      (max, note) => Math.max(max, note.lengthQuarters ?? 0),
      0,
    );
    const gap = next ? next.onsetQuarters - step.onsetQuarters : 0;
    const durationQuarters = gap > 1e-9 ? gap : longestNote > 0 ? longestNote : 1;

    // De-duplicate: the same pitch can appear twice at one onset when voices
    // double it, which would otherwise make the chord impossible to complete.
    const byMidi = new Map<number, ScoreNote>();
    for (const note of step.notes) {
      const existing = byMidi.get(note.midi);
      if (!existing) {
        byMidi.set(note.midi, {
          midi: note.midi,
          staff: note.staff,
          tiedFromPrevious: note.tiedFromPrevious,
        });
      } else if (existing.tiedFromPrevious && !note.tiedFromPrevious) {
        // If any voice strikes the pitch, it counts as struck.
        byMidi.set(note.midi, { ...existing, tiedFromPrevious: false });
      }
    }

    return {
      index,
      notes: [...byMidi.values()].sort((a, b) => a.midi - b.midi),
      measure: step.measure,
      onsetQuarters: step.onsetQuarters,
      durationQuarters,
      cursorIndex: step.cursorIndex,
    };
  });

  return {
    title: options.title ?? 'Untitled score',
    events,
    tempoBpm: options.tempoBpm ?? null,
    measureCount: merged.reduce((max, step) => Math.max(max, step.measure), 0),
    source: options.source ?? 'musicxml',
  };
}
