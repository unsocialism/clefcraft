import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { PdfNote } from '../pdf/pdfNotes.ts';
import { scoreFromPdfNotes } from './pdfScore.ts';

const note = (over: Partial<PdfNote> & { midi: number; x: number }): PdfNote => ({
  page: 1,
  measure: 1,
  staff: 1,
  system: 0,
  clef: 'treble',
  pitch: { step: 'C', alter: 0, octave: 4 },
  y: 100,
  centerX: (over.x ?? 0) + 3,
  positionError: 0,
  ...over,
});

describe('building a practice score from a PDF', () => {
  it('groups notes drawn at the same horizontal position', () => {
    const { score } = scoreFromPdfNotes([
      note({ midi: 60, x: 100 }),
      note({ midi: 64, x: 100 }),
      note({ midi: 67, x: 100.2 }),
      note({ midi: 72, x: 140 }),
    ]);
    assert.equal(score.events.length, 2);
    assert.deepEqual(
      score.events[0]!.notes.map((n) => n.midi),
      [60, 64, 67],
    );
    assert.deepEqual(
      score.events[1]!.notes.map((n) => n.midi),
      [72],
    );
  });

  it('keeps both hands of a chord together', () => {
    const { score } = scoreFromPdfNotes([
      note({ midi: 72, x: 100, staff: 1 }),
      note({ midi: 48, x: 100, staff: 2 }),
    ]);
    assert.equal(score.events.length, 1);
    assert.deepEqual(
      score.events[0]!.notes.map((n) => n.staff),
      [1, 2],
    );
  });

  it('never merges across a system boundary', () => {
    // Two systems occupy the same horizontal range on the page, so position
    // alone would make the first note of one simultaneous with the first of
    // the next.
    const { score } = scoreFromPdfNotes([
      note({ midi: 60, x: 100, system: 0 }),
      note({ midi: 62, x: 100, system: 1 }),
    ]);
    assert.equal(score.events.length, 2);
  });

  it('counts a doubled pitch once', () => {
    const { score } = scoreFromPdfNotes([
      note({ midi: 60, x: 100, staff: 1 }),
      note({ midi: 60, x: 100, staff: 2 }),
    ]);
    assert.deepEqual(
      score.events[0]!.notes.map((n) => n.midi),
      [60],
    );
  });

  it('orders events across systems, not by x across the page', () => {
    const { score } = scoreFromPdfNotes([
      note({ midi: 71, x: 400, system: 0 }),
      note({ midi: 60, x: 50, system: 1 }),
    ]);
    assert.deepEqual(
      score.events.map((e) => e.notes[0]!.midi),
      [71, 60],
    );
  });

  it('anchors each event where it was drawn', () => {
    const { anchors } = scoreFromPdfNotes([
      note({ midi: 60, x: 100, y: 200, page: 2 }),
      note({ midi: 64, x: 100, y: 210, page: 2 }),
    ]);
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0]!.page, 2);
    assert.equal(anchors[0]!.x, 103);
    assert.deepEqual([...anchors[0]!.ys].sort((a, b) => a - b), [200, 210]);
  });

  it('records which hand each anchored notehead belongs to', () => {
    const { anchors } = scoreFromPdfNotes([
      note({ midi: 72, x: 100, y: 300, staff: 1 }),
      note({ midi: 48, x: 100, y: 200, staff: 2 }),
    ]);
    const byY = new Map(anchors[0]!.ys.map((y, i) => [y, anchors[0]!.staves[i]]));
    assert.equal(byY.get(300), 1);
    assert.equal(byY.get(200), 2);
  });

  it('reports the measure count and marks the source', () => {
    const { score } = scoreFromPdfNotes([
      note({ midi: 60, x: 100, measure: 1 }),
      note({ midi: 62, x: 200, measure: 7 }),
    ]);
    assert.equal(score.measureCount, 7);
    assert.equal(score.source, 'pdf');
    // Rhythm is not read, so there is no tempo to honour.
    assert.equal(score.tempoBpm, null);
  });

  it('produces nothing from nothing', () => {
    const { score, anchors } = scoreFromPdfNotes([]);
    assert.equal(score.events.length, 0);
    assert.equal(anchors.length, 0);
  });
});
