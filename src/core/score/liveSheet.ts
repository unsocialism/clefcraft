/**
 * Writing free play out as it happens.
 *
 * The live staff used to be a row of slots filled from the right: every new
 * note pushed the row along and the whole staff marched sideways. It read
 * like a ticker tape, which is not what music looks like. This lays the same
 * notes out the way a page does — left to right, four bars to a line, a new
 * line when the last one is full — and, crucially, *never moves a note once
 * it is written*. What you played ten seconds ago is where you last saw it.
 *
 * Rhythm is not written. Every press takes the next slot, four to a bar,
 * whatever you actually held: free play is played to no clock, and a
 * rhythm guessed from it would have to be re-guessed — and the page
 * re-written under your hands — with every note you add. The rolling bars
 * under the keyboard show how long you held each key; this shows what the
 * notes were.
 *
 * The sheet is endless and the window on to it is not: only the last few
 * lines are kept, and a line leaves the top whole rather than a note at a
 * time, so the page turns once every sixteen notes instead of shuffling
 * upward constantly.
 */

import type { Moment } from '../midi/trail.ts';

/** A moment and the slot it was written in, counted from the first note. */
export interface Placed {
  readonly slot: number;
  readonly moment: Moment;
}

export interface SheetState {
  /** Oldest first. Trimmed from the front as the sheet runs on. */
  readonly placed: readonly Placed[];
  /** The slot the next new moment takes. */
  readonly next: number;
}

export const EMPTY_SHEET: SheetState = { placed: [], next: 0 };

/**
 * Take in what the trail is holding and write anything new on the end.
 *
 * Moments already on the sheet are updated in place rather than appended:
 * a chord grows while its keys go down — `momentsOf` gathers presses inside
 * seventy milliseconds into one moment — and the moment that arrives with
 * three notes in it is the same moment that arrived with one.
 *
 * `keep` is counted in slots and rounded down to whole lines by the caller;
 * anything older than that is forgotten, which is what stops a long session
 * from growing without bound.
 */
export function writeMoments(
  state: SheetState,
  moments: readonly Moment[],
  keep: number,
): SheetState {
  if (moments.length === 0) return state;
  const bySlot = new Map(state.placed.map((entry) => [entry.moment.id, entry.slot]));
  const updated = new Map<number, Moment>();
  const fresh: Placed[] = [];
  let next = state.next;

  for (const moment of moments) {
    const slot = bySlot.get(moment.id);
    if (slot === undefined) fresh.push({ slot: next++, moment });
    else updated.set(moment.id, moment);
  }

  const placed = [
    ...state.placed.map((entry) => {
      const newer = updated.get(entry.moment.id);
      return newer ? { slot: entry.slot, moment: newer } : entry;
    }),
    ...fresh,
  ];
  const first = Math.max(0, placed.length - keep);
  return { placed: first > 0 ? placed.slice(first) : placed, next };
}

/** A sheet that has been cleared has nothing of the last one on it. */
export function restartWhenEmpty(state: SheetState, moments: readonly Moment[]): SheetState {
  return moments.length === 0 ? EMPTY_SHEET : state;
}

export interface SheetLayout {
  /** One row per line shown; each row is its slots, empty ones null. */
  readonly rows: readonly (readonly (Moment | null)[])[];
  /** Where the newest moment sits, for marking it. */
  readonly newest: { readonly row: number; readonly slot: number } | null;
  /** True while the first line shown is the first line played. */
  readonly fromTheStart: boolean;
}

export interface SheetShape {
  readonly barsPerLine: number;
  readonly beatsPerBar: number;
  readonly lines: number;
}

/**
 * The last few lines of the sheet, as rows of slots.
 *
 * The window moves a whole line at a time: the line being written is always
 * the last one shown, so a note lands in the same place on the page whether
 * it is the first of a line or the last of one.
 */
export function sheetRows(state: SheetState, shape: SheetShape): SheetLayout {
  const perLine = shape.barsPerLine * shape.beatsPerBar;
  const last = state.placed[state.placed.length - 1];
  const lastLine = last ? Math.floor(last.slot / perLine) : 0;
  const firstLine = Math.max(0, lastLine - shape.lines + 1);

  const rows: (Moment | null)[][] = [];
  for (let line = 0; line < shape.lines; line++) {
    rows.push(new Array<Moment | null>(perLine).fill(null));
  }
  let newest: { row: number; slot: number } | null = null;
  for (const entry of state.placed) {
    const row = Math.floor(entry.slot / perLine) - firstLine;
    if (row < 0 || row >= shape.lines) continue;
    const slot = entry.slot % perLine;
    rows[row]![slot] = entry.moment;
    if (entry === last) newest = { row, slot };
  }
  return { rows, newest, fromTheStart: firstLine === 0 };
}
