/**
 * A score reduced to what practising needs: an ordered list of moments, each
 * with the notes that must sound at it.
 *
 * Deliberately not a full notation model. Ties, slurs, dynamics and beaming
 * belong to the renderer; this is the thing the practice engine matches your
 * playing against, and the thing the PDF path will eventually have to produce
 * too. Keeping it small is what lets both sources feed one engine.
 */

export type Hand = 'right' | 'left';

export interface ScoreNote {
  readonly midi: number;
  /** 1 = topmost staff. Used to colour or filter by hand. */
  readonly staff: number;
  /** Notes continuing from a previous event are not re-struck. */
  readonly tiedFromPrevious: boolean;
}

export interface ScoreEvent {
  /** Position in the score, 0-based; also the cursor step count. */
  readonly index: number;
  /** Notes that begin sounding at this moment. Never empty. */
  readonly notes: readonly ScoreNote[];
  /** Measure number as printed, for display and seeking. */
  readonly measure: number;
  /** Onset in quarter notes from the start of the piece. */
  readonly onsetQuarters: number;
  /** How long until the next event, in quarter notes. */
  readonly durationQuarters: number;
  /**
   * Position of this event in the source cursor's own step sequence.
   *
   * Not the same as `index`: rests are dropped from `events` but still occupy
   * a cursor step, so driving OSMD's cursor by `index` would drift out of
   * sync with the notation as soon as the piece contains a rest.
   */
  readonly cursorIndex: number;
}

export interface Score {
  readonly title: string;
  readonly events: readonly ScoreEvent[];
  /** Beats per minute the file asks for, when it says. */
  readonly tempoBpm: number | null;
  readonly measureCount: number;
  /** Where the score came from, for the UI to label. */
  readonly source: 'musicxml' | 'pdf' | 'test';
}

export const EMPTY_SCORE: Score = {
  title: '',
  events: [],
  tempoBpm: null,
  measureCount: 0,
  source: 'test',
};

/** The distinct MIDI numbers an event expects to be struck. */
export function expectedNotes(event: ScoreEvent): Set<number> {
  const notes = new Set<number>();
  for (const note of event.notes) {
    if (!note.tiedFromPrevious) notes.add(note.midi);
  }
  return notes;
}

/** Which staff a note is on, expressed as a hand for a two-staff piano score. */
export function handOf(note: ScoreNote): Hand {
  return note.staff <= 1 ? 'right' : 'left';
}
