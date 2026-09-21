/**
 * Hand corrections to a PDF reading.
 *
 * The reader is right or obviously wrong, but "obviously wrong" still needs
 * fixing, and a PDF can use a glyph the reader has never seen. Corrections
 * are kept as a list of changes against the reading rather than as an
 * edited copy of it, for two reasons: they stay small enough to store per
 * file, and when the reader improves, the corrections still apply on top of
 * the better reading instead of freezing the old one in place.
 *
 * Everything here is pure. The UI keeps a history of `NoteEdits` values for
 * undo; nothing mutates.
 */

import { spellNote } from '../music/pitch.ts';
import {
  bottomY,
  clefAt,
  pitchAt,
  stepsAboveBottomLine,
  toMidi,
  topY,
  type WrittenPitch,
} from './staffGeometry.ts';
import type { PdfNote, PdfPageLayout, StaffInfo } from './pdfNotes.ts';

export interface NoteChange {
  readonly midi: number;
  readonly staff: number;
}

export interface NoteEdits {
  readonly version: 1;
  /** Notes the reader found, with a new pitch or hand. Keyed by note id. */
  readonly changed: Readonly<Record<string, NoteChange>>;
  /** Notes the reader found that are not really there. */
  readonly removed: readonly string[];
  /** Notes the reader missed. */
  readonly added: readonly PdfNote[];
}

export const NO_EDITS: NoteEdits = { version: 1, changed: {}, removed: [], added: [] };

/** How a displayed note came to be, for marking it on the page. */
export type EditState = 'read' | 'changed' | 'added';

export interface EditedNote extends PdfNote {
  readonly id: string;
  readonly edit: EditState;
}

/**
 * A stable name for a note the reader found.
 *
 * The reader is deterministic, so the same PDF yields the same coordinates
 * every time, and a position to a tenth of a point is unique: two noteheads
 * cannot be drawn on top of each other.
 */
export function noteId(note: { page: number; x: number; y: number }): string {
  return `${note.page}:${note.x.toFixed(1)}:${note.y.toFixed(1)}`;
}

/** Added notes live in their own namespace so they never collide with read ones. */
function addedId(note: { page: number; x: number; y: number }): string {
  return `+${noteId(note)}`;
}

export function editCount(edits: NoteEdits): number {
  return Object.keys(edits.changed).length + edits.removed.length + edits.added.length;
}

/**
 * The spelling to show for a pitch someone has changed by hand.
 *
 * Spelt in the staff's key, so a note raised from F in G major reads F♯,
 * not G♭ — the page says F♯ and showing G♭ beside it would look like a
 * second mistake.
 */
function respell(midi: number, keyFifths: number): WrittenPitch {
  const spelled = spellNote(midi, keyFifths);
  return { step: spelled.step, alter: spelled.alter, octave: spelled.octave };
}

function infoFor(
  layouts: readonly PdfPageLayout[],
  note: { page: number; system: number; staff: number },
): StaffInfo | undefined {
  const page = layouts.find((l) => l.page === note.page);
  return page?.staffInfo.find((i) => i.system === note.system && i.staffNumber === note.staff);
}

/** The reading with every correction applied, in reading order. */
export function applyEdits(
  notes: readonly PdfNote[],
  edits: NoteEdits,
  layouts: readonly PdfPageLayout[] = [],
): EditedNote[] {
  const removed = new Set(edits.removed);
  const result: EditedNote[] = [];

  for (const note of notes) {
    const id = noteId(note);
    if (removed.has(id)) continue;
    const change = edits.changed[id];
    if (!change) {
      result.push({ ...note, id, edit: 'read' });
      continue;
    }
    const fifths = infoFor(layouts, { ...note, staff: change.staff })?.keyFifths ?? 0;
    result.push({
      ...note,
      id,
      edit: 'changed',
      midi: change.midi,
      staff: change.staff,
      pitch: change.midi === note.midi ? note.pitch : respell(change.midi, fifths),
      positionError: 0,
    });
  }

  for (const note of edits.added) {
    const id = addedId(note);
    if (removed.has(id)) continue;
    result.push({ ...note, id, edit: 'added' });
  }

  return result.sort(
    (a, b) => a.system - b.system || a.x - b.x || a.staff - b.staff || b.y - a.y,
  );
}

/** Move a note by some semitones: ±1 for an accidental, ±12 for an octave. */
export function shiftNote(edits: NoteEdits, note: EditedNote, semitones: number): NoteEdits {
  const midi = Math.min(108, Math.max(21, note.midi + semitones));
  if (note.edit === 'added') {
    return replaceAdded(edits, note.id, (n) => ({ ...n, midi, pitch: respellLike(n, midi) }));
  }
  return withChange(edits, note, { midi, staff: note.staff });
}

/** Give a note to the other hand. */
export function switchHand(edits: NoteEdits, note: EditedNote): NoteEdits {
  const staff = note.staff <= 1 ? 2 : 1;
  if (note.edit === 'added') return replaceAdded(edits, note.id, (n) => ({ ...n, staff }));
  return withChange(edits, note, { midi: note.midi, staff });
}

export function removeNote(edits: NoteEdits, note: EditedNote): NoteEdits {
  if (note.edit === 'added') {
    // An added note was never in the reading, so deleting it simply
    // un-adds it rather than leaving a tombstone behind.
    return { ...edits, added: edits.added.filter((n) => addedId(n) !== note.id) };
  }
  const changed = { ...edits.changed };
  delete changed[note.id];
  return { ...edits, changed, removed: [...new Set([...edits.removed, note.id])] };
}

export function addNote(edits: NoteEdits, note: PdfNote): NoteEdits {
  const id = addedId(note);
  if (edits.added.some((n) => addedId(n) === id)) return edits;
  return { ...edits, added: [...edits.added, note] };
}

/** The id a freshly added note will have, so the UI can select it. */
export function idOfAdded(note: PdfNote): string {
  return addedId(note);
}

function withChange(edits: NoteEdits, note: EditedNote, change: NoteChange): NoteEdits {
  const changed = { ...edits.changed, [note.id]: change };
  return { ...edits, changed };
}

function replaceAdded(
  edits: NoteEdits,
  id: string,
  update: (note: PdfNote) => PdfNote,
): NoteEdits {
  return {
    ...edits,
    added: edits.added.map((n) => (addedId(n) === id ? update(n) : n)),
  };
}

function respellLike(note: PdfNote, midi: number): WrittenPitch {
  // Keep the key's preference: a note whose written pitch was sharp stays
  // on the sharp side, a flat one on the flat side.
  return respell(midi, note.pitch.alter < 0 ? -1 : 1);
}

/**
 * The note a click on the page stands for.
 *
 * The click lands near a staff position, not on one — a finger or a mouse is
 * not that precise — so it is snapped to the nearest line or space of the
 * nearest staff. The pitch then follows the same rules the reader uses: the
 * clef in force at that point on the staff, then the key signature. An
 * accidental written in the bar is not assumed; one tap of ♯ or ♭ adds it.
 */
export function noteAtPoint(
  layout: PdfPageLayout,
  x: number,
  y: number,
): PdfNote | null {
  let best: StaffInfo | null = null;
  let bestSteps = Infinity;
  for (const info of layout.staffInfo) {
    const { staff } = info;
    if (x < staff.x0 - 2 || x > staff.x1 + 2) continue;
    const steps = Math.abs((y - (topY(staff) + bottomY(staff)) / 2) / (staff.spacing / 2));
    if (steps < bestSteps) {
      bestSteps = steps;
      best = info;
    }
  }
  // Further out than any ledger line reaches: not a click on a staff.
  if (!best || bestSteps > 20) return null;

  const { staff } = best;
  const clef = clefAt(best.clefs, x);
  if (!clef) return null;

  const steps = stepsAboveBottomLine(y, staff);
  const snappedY = bottomY(staff) + steps * (staff.spacing / 2);
  const written = pitchAt(snappedY, staff, clef);
  const alter = best.key[written.step] ?? 0;
  const pitch: WrittenPitch = { ...written, alter };

  return {
    page: layout.page,
    measure: best.measureBase + best.barlines.filter((b) => b <= x).length,
    staff: best.staffNumber,
    system: best.system,
    clef,
    pitch,
    midi: toMidi(pitch),
    x,
    y: snappedY,
    centerX: x,
    positionError: 0,
  };
}
