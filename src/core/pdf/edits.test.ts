import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_EDITS,
  addNote,
  applyEdits,
  editCount,
  idOfAdded,
  noteAtPoint,
  noteId,
  removeNote,
  shiftNote,
  switchHand,
  type EditedNote,
} from './edits.ts';
import type { PdfNote, PdfPageLayout, StaffInfo } from './pdfNotes.ts';
import type { Staff } from './staffGeometry.ts';

const note = (over: Partial<PdfNote> & { midi: number; x: number }): PdfNote => ({
  page: 1,
  measure: 1,
  staff: 1,
  system: 0,
  clef: 'treble',
  pitch: { step: 'C', alter: 0, octave: 4 },
  y: 100,
  centerX: over.x + 3,
  positionError: 0,
  ...over,
});

const find = (notes: readonly EditedNote[], midi: number) => notes.find((n) => n.midi === midi);

describe('applying edits', () => {
  const reading = [note({ midi: 60, x: 100 }), note({ midi: 64, x: 150 }), note({ midi: 67, x: 200 })];

  it('leaves an unedited reading alone, but gives every note an id', () => {
    const shown = applyEdits(reading, NO_EDITS);
    assert.equal(shown.length, 3);
    assert.ok(shown.every((n) => n.edit === 'read' && n.id.length > 0));
  });

  it('shifts a note by a semitone and by an octave', () => {
    const [first] = applyEdits(reading, NO_EDITS);
    let edits = shiftNote(NO_EDITS, first!, 1);
    let shown = applyEdits(reading, edits);
    assert.equal(shown[0]!.midi, 61);
    assert.equal(shown[0]!.edit, 'changed');

    edits = shiftNote(edits, shown[0]!, 12);
    shown = applyEdits(reading, edits);
    assert.equal(shown[0]!.midi, 73);
    // Still one change record, not two stacked ones.
    assert.equal(editCount(edits), 1);
  });

  it('respells a changed note so its label matches the new pitch', () => {
    const [first] = applyEdits(reading, NO_EDITS);
    const shown = applyEdits(reading, shiftNote(NO_EDITS, first!, 1));
    const { step, alter, octave } = shown[0]!.pitch;
    // C4 raised a semitone: C♯4 in a sharp-leaning spelling.
    assert.deepEqual({ step, alter, octave }, { step: 'C', alter: 1, octave: 4 });
  });

  it('keeps the engraved spelling when a change leaves the pitch alone', () => {
    const [first] = applyEdits(reading, NO_EDITS);
    const shown = applyEdits(reading, switchHand(NO_EDITS, first!));
    assert.deepEqual(shown[0]!.pitch, reading[0]!.pitch);
    assert.equal(shown[0]!.staff, 2);
  });

  it('switches a note to the other hand and back', () => {
    const [first] = applyEdits(reading, NO_EDITS);
    let edits = switchHand(NO_EDITS, first!);
    let shown = applyEdits(reading, edits);
    assert.equal(shown[0]!.staff, 2);
    edits = switchHand(edits, shown[0]!);
    shown = applyEdits(reading, edits);
    assert.equal(shown[0]!.staff, 1);
  });

  it('removes a note, discarding any earlier change to it', () => {
    const [first] = applyEdits(reading, NO_EDITS);
    let edits = shiftNote(NO_EDITS, first!, 1);
    edits = removeNote(edits, applyEdits(reading, edits)[0]!);
    const shown = applyEdits(reading, edits);
    assert.equal(shown.length, 2);
    assert.equal(find(shown, 61), undefined);
    assert.equal(Object.keys(edits.changed).length, 0);
  });

  it('adds a missed note in reading order', () => {
    const missed = note({ midi: 62, x: 125 });
    const shown = applyEdits(reading, addNote(NO_EDITS, missed));
    assert.deepEqual(
      shown.map((n) => n.midi),
      [60, 62, 64, 67],
    );
    assert.equal(find(shown, 62)!.edit, 'added');
    assert.equal(find(shown, 62)!.id, idOfAdded(missed));
  });

  it('does not add the same note twice', () => {
    const missed = note({ midi: 62, x: 125 });
    const edits = addNote(addNote(NO_EDITS, missed), missed);
    assert.equal(edits.added.length, 1);
  });

  it('un-adds an added note on delete instead of leaving a tombstone', () => {
    const missed = note({ midi: 62, x: 125 });
    let edits = addNote(NO_EDITS, missed);
    edits = removeNote(edits, find(applyEdits(reading, edits), 62)!);
    assert.equal(edits.added.length, 0);
    assert.equal(edits.removed.length, 0);
    assert.equal(editCount(edits), 0);
  });

  it('edits an added note in place', () => {
    const missed = note({ midi: 62, x: 125 });
    let edits = addNote(NO_EDITS, missed);
    edits = shiftNote(edits, find(applyEdits(reading, edits), 62)!, -1);
    const shown = applyEdits(reading, edits);
    assert.ok(find(shown, 61));
    assert.equal(find(shown, 61)!.edit, 'added');
    assert.equal(edits.added.length, 1);
  });

  it('keeps notes on the piano', () => {
    const [low] = applyEdits([note({ midi: 22, x: 100 })], NO_EDITS);
    const shown = applyEdits([note({ midi: 22, x: 100 })], shiftNote(NO_EDITS, low!, -12));
    assert.equal(shown[0]!.midi, 21);
  });

  it('survives a re-read: edits key on position, which the reader reproduces', () => {
    const [first] = applyEdits(reading, NO_EDITS);
    const edits = shiftNote(NO_EDITS, first!, 1);
    // A fresh reading of the same file: new objects, same coordinates.
    const again = reading.map((n) => ({ ...n }));
    assert.equal(applyEdits(again, edits)[0]!.midi, 61);
    assert.equal(noteId(again[0]!), first!.id);
  });
});

describe('turning a click into a note', () => {
  // A treble staff with its bottom line (E4) at y = 100, spacing 5.
  const staff: Staff = {
    lineYs: [120, 115, 110, 105, 100],
    spacing: 5,
    x0: 50,
    x1: 550,
  };
  const info = (over: Partial<StaffInfo> = {}): StaffInfo => ({
    staff,
    system: 3,
    staffNumber: 1,
    clefs: [{ x: 55, clef: 'treble' }],
    key: {},
    keyFifths: 0,
    barlines: [50, 200, 350, 550],
    measureBase: 10,
    ...over,
  });
  const layout = (over: Partial<StaffInfo> = {}): PdfPageLayout => ({
    page: 2,
    staves: [staff],
    systems: [[staff]],
    barlines: [50, 200, 350, 550],
    staffInfo: [info(over)],
  });

  it('snaps to the nearest line or space', () => {
    // Just off the G line (one space above the bottom): G4.
    const n = noteAtPoint(layout(), 120, 106.2)!;
    assert.equal(n.midi, 67);
    assert.equal(n.y, 105);
  });

  it('applies the key signature', () => {
    // F line in G major: F♯5.
    const n = noteAtPoint(layout({ key: { F: 1 }, keyFifths: 1 }), 120, 120)!;
    assert.equal(n.midi, 78);
    assert.equal(n.pitch.alter, 1);
  });

  it('uses the clef in force at that point on the staff', () => {
    const withChange = layout({
      clefs: [
        { x: 55, clef: 'treble' },
        { x: 300, clef: 'bass' },
      ],
    });
    // Bottom line: E4 under treble, G2 under bass.
    assert.equal(noteAtPoint(withChange, 120, 100)!.midi, 64);
    assert.equal(noteAtPoint(withChange, 400, 100)!.midi, 43);
  });

  it('places the note in the right measure, system, staff and page', () => {
    const n = noteAtPoint(layout(), 250, 100)!;
    assert.equal(n.measure, 12);
    assert.equal(n.system, 3);
    assert.equal(n.staff, 1);
    assert.equal(n.page, 2);
  });

  it('refuses a click nowhere near a staff', () => {
    assert.equal(noteAtPoint(layout(), 120, 400), null);
  });

  it('refuses a click outside the staff horizontally', () => {
    assert.equal(noteAtPoint(layout(), 10, 110), null);
  });
});
