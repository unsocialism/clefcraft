import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_SHEET,
  restartWhenEmpty,
  sheetRows,
  writeMoments,
  type SheetState,
} from './liveSheet.ts';
import type { Moment } from '../midi/trail.ts';

const moment = (id: number, notes: readonly number[] = [60]): Moment => ({
  id,
  atMs: id * 100,
  notes,
  held: false,
});

/** Four bars of four beats: one line of the sheet. */
const SHAPE = { barsPerLine: 4, beatsPerBar: 4, lines: 4 };
const PER_LINE = SHAPE.barsPerLine * SHAPE.beatsPerBar;
const KEEP = PER_LINE * SHAPE.lines;

const play = (ids: readonly number[], from: SheetState = EMPTY_SHEET): SheetState =>
  ids.reduce((state, id) => writeMoments(state, [moment(id)], KEEP), from);

describe('writing what was played on to the sheet', () => {
  it('gives each new moment the next slot', () => {
    const state = play([1, 2, 3]);
    assert.deepEqual(
      state.placed.map((entry) => entry.slot),
      [0, 1, 2],
    );
    assert.equal(state.next, 3);
  });

  it('takes the whole trail at once and writes only what is new', () => {
    let state = writeMoments(EMPTY_SHEET, [moment(1), moment(2)], KEEP);
    state = writeMoments(state, [moment(1), moment(2), moment(3)], KEEP);
    assert.equal(state.placed.length, 3);
    assert.deepEqual(
      state.placed.map((entry) => entry.slot),
      [0, 1, 2],
    );
  });

  it('lets a chord grow in the slot it already has', () => {
    // A chord arrives a note at a time: the keys go down within a few
    // milliseconds of each other and are gathered into one moment.
    let state = writeMoments(EMPTY_SHEET, [moment(7, [60])], KEEP);
    state = writeMoments(state, [moment(7, [60, 64, 67])], KEEP);
    assert.equal(state.placed.length, 1);
    assert.equal(state.placed[0]!.slot, 0);
    assert.deepEqual(state.placed[0]!.moment.notes, [60, 64, 67]);
  });

  it('never moves a note that is already written', () => {
    const three = play([1, 2, 3]);
    const more = play([4, 5, 6], three);
    for (const entry of three.placed) {
      const later = more.placed.find((other) => other.moment.id === entry.moment.id);
      assert.equal(later?.slot, entry.slot, `moment ${entry.moment.id} stayed put`);
    }
  });

  it('forgets the oldest once the sheet is full', () => {
    const state = play([...Array(KEEP + 10).keys()].map((i) => i + 1));
    assert.equal(state.placed.length, KEEP);
    assert.equal(state.placed[0]!.moment.id, 11);
    assert.equal(state.placed[0]!.slot, 10);
  });

  it('starts a fresh sheet when the trail has been cleared', () => {
    const state = play([1, 2, 3]);
    assert.equal(restartWhenEmpty(state, []).placed.length, 0);
    assert.equal(restartWhenEmpty(state, [moment(1)]), state, 'and not while there is anything');
  });
});

describe('laying the sheet out in lines', () => {
  it('fills the first line from the left', () => {
    const layout = sheetRows(play([1, 2, 3]), SHAPE);
    assert.equal(layout.rows.length, 4);
    assert.deepEqual(
      layout.rows[0]!.slice(0, 4).map((slot) => slot?.id ?? null),
      [1, 2, 3, null],
    );
    assert.deepEqual(layout.newest, { row: 0, slot: 2 });
    assert.equal(layout.fromTheStart, true);
  });

  it('starts a new line when the last one is full', () => {
    const layout = sheetRows(play([...Array(PER_LINE + 1).keys()].map((i) => i + 1)), SHAPE);
    assert.equal(layout.rows[0]!.filter(Boolean).length, PER_LINE);
    assert.deepEqual(layout.newest, { row: 1, slot: 0 });
  });

  it('turns a whole line at a time once the page is full', () => {
    // One line past the bottom: the top line goes, the rest move up whole,
    // and what is being written is still on the last line.
    const state = play([...Array(PER_LINE * SHAPE.lines + 1).keys()].map((i) => i + 1));
    const layout = sheetRows(state, SHAPE);
    assert.equal(layout.newest?.row, SHAPE.lines - 1);
    assert.equal(layout.newest?.slot, 0);
    assert.equal(layout.fromTheStart, false, 'the first line played has scrolled off');
    assert.equal(layout.rows[0]![0]?.id, PER_LINE + 1, 'the second line played is now the top');
  });

  it('shows fewer lines when it is given fewer', () => {
    const state = play([...Array(PER_LINE * 3).keys()].map((i) => i + 1));
    const layout = sheetRows(state, { ...SHAPE, lines: 1 });
    assert.equal(layout.rows.length, 1);
    assert.equal(layout.rows[0]![0]?.id, PER_LINE * 2 + 1, 'the line being written');
  });

  it('is empty, not broken, before anything is played', () => {
    const layout = sheetRows(EMPTY_SHEET, SHAPE);
    assert.equal(layout.newest, null);
    assert.equal(layout.rows.length, 4);
    assert.ok(layout.rows.every((row) => row.every((slot) => slot === null)));
    assert.equal(layout.fromTheStart, true);
  });
});
