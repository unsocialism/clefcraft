import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildScoreFromSteps, type CursorStep } from './fromSteps.ts';

let stepCounter = 0;
const step = (
  onsetQuarters: number,
  measure: number,
  notes: CursorStep['notes'],
): CursorStep => ({ cursorIndex: stepCounter++, onsetQuarters, measure, notes });

const n = (midi: number, extra: Partial<CursorStep['notes'][number]> = {}) => ({
  midi,
  staff: 1,
  tiedFromPrevious: false,
  ...extra,
});

describe('buildScoreFromSteps', () => {
  it('derives each duration from the gap to the next event', () => {
    const score = buildScoreFromSteps([
      step(0, 1, [n(60)]),
      step(1, 1, [n(62)]),
      step(3, 1, [n(64, { lengthQuarters: 1 })]),
    ]);
    assert.deepEqual(score.events.map((e) => e.durationQuarters), [1, 2, 1]);
  });

  it('uses the note length for the final event', () => {
    const score = buildScoreFromSteps([step(0, 1, [n(60, { lengthQuarters: 4 })])]);
    assert.equal(score.events[0]?.durationQuarters, 4);
  });

  it('falls back to one quarter when the last note has no length', () => {
    const score = buildScoreFromSteps([step(0, 1, [n(60)])]);
    assert.equal(score.events[0]?.durationQuarters, 1);
  });

  it('drops rests but keeps the time they occupy', () => {
    const score = buildScoreFromSteps([
      step(0, 1, [n(60)]),
      step(1, 1, []), // a quarter rest
      step(2, 1, [n(64)]),
    ]);
    assert.equal(score.events.length, 2);
    assert.equal(
      score.events[0]?.durationQuarters,
      2,
      'the note before a rest must span the rest, or tempo mode runs ahead',
    );
    assert.equal(score.events[1]?.onsetQuarters, 2);
  });

  it('merges the two staves of a grand staff reported separately', () => {
    const score = buildScoreFromSteps([
      step(0, 1, [n(60), n(64)]),
      step(0, 1, [n(36, { staff: 2 })]),
      step(1, 1, [n(65)]),
    ]);
    assert.equal(score.events.length, 2);
    assert.deepEqual(score.events[0]?.notes.map((note) => note.midi), [36, 60, 64]);
    assert.equal(score.events[0]?.notes[0]?.staff, 2);
  });

  it('sorts notes within an event low to high', () => {
    const score = buildScoreFromSteps([step(0, 1, [n(67), n(60), n(64)])]);
    assert.deepEqual(score.events[0]?.notes.map((note) => note.midi), [60, 64, 67]);
  });

  it('sorts events by onset even if the source is out of order', () => {
    const score = buildScoreFromSteps([
      step(2, 1, [n(64)]),
      step(0, 1, [n(60)]),
      step(1, 1, [n(62)]),
    ]);
    assert.deepEqual(score.events.map((e) => e.onsetQuarters), [0, 1, 2]);
    assert.deepEqual(score.events.map((e) => e.index), [0, 1, 2]);
  });

  it('collapses a pitch doubled across voices into one note', () => {
    // Two voices both writing middle C at the same moment. Left as two
    // entries, the chord could never be completed by playing one key.
    const score = buildScoreFromSteps([step(0, 1, [n(60), n(60), n(67)])]);
    assert.deepEqual(score.events[0]?.notes.map((note) => note.midi), [60, 67]);
  });

  it('treats a doubled pitch as struck if any voice strikes it', () => {
    const score = buildScoreFromSteps([
      step(0, 1, [n(60, { tiedFromPrevious: true }), n(60, { tiedFromPrevious: false })]),
    ]);
    assert.equal(score.events[0]?.notes[0]?.tiedFromPrevious, false);
  });

  it('keeps a pitch tied when every voice ties it', () => {
    const score = buildScoreFromSteps([
      step(0, 1, [n(60, { tiedFromPrevious: true }), n(60, { tiedFromPrevious: true })]),
    ]);
    assert.equal(score.events[0]?.notes[0]?.tiedFromPrevious, true);
  });

  it('records measure numbers and the measure count', () => {
    const score = buildScoreFromSteps([
      step(0, 1, [n(60)]),
      step(4, 2, [n(62)]),
      step(8, 3, []), // an empty final measure still counts
    ]);
    assert.deepEqual(score.events.map((e) => e.measure), [1, 2]);
    assert.equal(score.measureCount, 3);
  });

  it('handles a score with no notes at all', () => {
    const score = buildScoreFromSteps([step(0, 1, []), step(1, 1, [])]);
    assert.deepEqual(score.events, []);
    assert.equal(score.measureCount, 1);
  });

  it('handles no steps at all', () => {
    const score = buildScoreFromSteps([]);
    assert.deepEqual(score.events, []);
    assert.equal(score.measureCount, 0);
  });

  it('carries the title, tempo and source through', () => {
    const score = buildScoreFromSteps([step(0, 1, [n(60)])], {
      title: 'Gymnopédie No. 1',
      tempoBpm: 60,
      source: 'pdf',
    });
    assert.equal(score.title, 'Gymnopédie No. 1');
    assert.equal(score.tempoBpm, 60);
    assert.equal(score.source, 'pdf');
  });

  it('tolerates floating-point onsets from triplet rhythms', () => {
    const third = 1 / 3;
    const score = buildScoreFromSteps([
      step(0, 1, [n(60)]),
      step(third, 1, [n(62)]),
      step(third * 2, 1, [n(64)]),
      step(1, 1, [n(65)]),
    ]);
    assert.equal(score.events.length, 4, 'near-equal onsets must not collapse into one');
  });
});
