/**
 * What has just been played, for free play to show live.
 *
 * Different from the recorder next door, and deliberately so: the recorder
 * is building a document, and keeps everything until you stop. This keeps
 * only the last few seconds, hands back notes that are still being held —
 * which is most of what makes a live view live — and throws away what has
 * scrolled off the end.
 *
 * Pure, like everything it sits beside: it is handed a clock reading rather
 * than looking one up, so a trail can be played out in a test in no time at
 * all.
 */

import type { MidiEvent } from './types.ts';

export interface LiveNote {
  readonly id: number;
  readonly midi: number;
  readonly startMs: number;
  /** Null while the key is still down. */
  readonly endMs: number | null;
  readonly velocity: number;
}

export interface TrailState {
  /** Oldest first. */
  readonly notes: readonly LiveNote[];
  readonly nextId: number;
}

export const EMPTY_TRAIL: TrailState = { notes: [], nextId: 1 };

/** How long a note stays in the trail after it has finished sounding. */
export const TRAIL_MS = 12_000;
/** A ceiling, so a long glissando cannot grow the list without end. */
const MOST_NOTES = 400;
/**
 * However old they are, this many notes are always kept. The roll shows the
 * last few seconds, but the staff shows the last few *moments* — and a
 * phrase played, then thought about for half a minute, should still be on
 * the staff when you come back to it.
 */
const ALWAYS_KEPT = 32;
/** Notes struck within this of each other are one moment on the staff. */
export const MOMENT_MS = 70;

export interface TrailOptions {
  readonly keepMs?: number;
  readonly mostNotes?: number;
}

/** Fold one event in, dropping whatever has scrolled out of sight. */
export function trailEvent(
  state: TrailState,
  event: MidiEvent,
  at: number,
  options: TrailOptions = {},
): TrailState {
  const { keepMs = TRAIL_MS, mostNotes = MOST_NOTES } = options;
  const forget = (notes: readonly LiveNote[]): LiveNote[] => {
    const recent = Math.max(0, notes.length - ALWAYS_KEPT);
    const kept = notes.filter(
      (note, index) => index >= recent || note.endMs === null || note.endMs > at - keepMs,
    );
    return kept.length > mostNotes ? kept.slice(kept.length - mostNotes) : kept;
  };

  if (event.type === 'noteon' && event.velocity > 0) {
    return {
      notes: [
        ...forget(state.notes),
        { id: state.nextId, midi: event.note, startMs: at, endMs: null, velocity: event.velocity },
      ],
      nextId: state.nextId + 1,
    };
  }

  if (event.type === 'noteoff' || (event.type === 'noteon' && event.velocity === 0)) {
    return { ...state, notes: forget(release(state.notes, event.note, at)) };
  }

  if (event.type === 'allnotesoff') {
    return {
      ...state,
      notes: forget(state.notes.map((note) => (note.endMs === null ? { ...note, endMs: at } : note))),
    };
  }

  // The pedal changes what is heard, not what was played.
  return state;
}

/** Let go of the key most recently struck at that pitch. */
function release(notes: readonly LiveNote[], midi: number, at: number): LiveNote[] {
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i]!;
    if (note.midi === midi && note.endMs === null) {
      const next = [...notes];
      next[i] = { ...note, endMs: Math.max(at, note.startMs) };
      return next;
    }
  }
  return [...notes];
}

export interface Moment {
  /** The id of its first note, so React can tell one moment from another. */
  readonly id: number;
  readonly atMs: number;
  /** Low to high, as a chord is read. */
  readonly notes: readonly number[];
  /** True while any of its keys is still down. */
  readonly held: boolean;
}

/**
 * The last few things you played, as moments rather than notes: the three
 * keys of a chord are one moment, not three, even though no two of them
 * land in the same millisecond.
 */
export function momentsOf(
  notes: readonly LiveNote[],
  limit = 8,
  windowMs = MOMENT_MS,
): Moment[] {
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs || a.id - b.id);
  const moments: { id: number; atMs: number; notes: number[]; held: boolean }[] = [];
  for (const note of sorted) {
    const last = moments[moments.length - 1];
    if (last && note.startMs - last.atMs <= windowMs) {
      if (!last.notes.includes(note.midi)) last.notes.push(note.midi);
      last.held = last.held || note.endMs === null;
    } else {
      moments.push({
        id: note.id,
        atMs: note.startMs,
        notes: [note.midi],
        held: note.endMs === null,
      });
    }
  }
  for (const moment of moments) moment.notes.sort((a, b) => a - b);
  return moments.slice(Math.max(0, moments.length - limit));
}
