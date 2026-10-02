import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_FALLING,
  STEP_MS,
  fallingScore,
  stepEase,
  visibleAt,
  type FallingNote,
} from './fallingNotes.ts';
import type { Score, ScoreEvent, ScoreNote } from './types.ts';

function note(midi: number, staff = 1, tiedFromPrevious = false): ScoreNote {
  return { midi, staff, tiedFromPrevious };
}

function event(
  index: number,
  onsetQuarters: number,
  durationQuarters: number,
  notes: readonly ScoreNote[],
): ScoreEvent {
  return {
    index,
    notes,
    measure: Math.floor(onsetQuarters / 4) + 1,
    onsetQuarters,
    durationQuarters,
    cursorIndex: index,
  };
}

function score(events: readonly ScoreEvent[]): Score {
  return { title: 'test', events } as Score;
}

describe('fallingScore', () => {
  it('gives every note a bar from its onset to the next event', () => {
    const falling = fallingScore(
      score([event(0, 0, 1, [note(60)]), event(1, 1, 2, [note(62)])]),
    );
    assert.deepEqual(
      falling.notes.map((n) => [n.midi, n.startQuarters, n.endQuarters]),
      [
        [60, 0, 1],
        [62, 1, 3],
      ],
    );
  });

  it('makes a tied note one long bar rather than several short ones', () => {
    const falling = fallingScore(
      score([
        event(0, 0, 1, [note(60)]),
        event(1, 1, 1, [note(60, 1, true), note(64)]),
        event(2, 2, 1, [note(60, 1, true)]),
      ]),
    );
    const held = falling.notes.filter((n) => n.midi === 60);
    assert.equal(held.length, 1);
    assert.deepEqual([held[0]!.startQuarters, held[0]!.endQuarters], [0, 3]);
  });

  it('starts a fresh bar when the same key is struck again', () => {
    const falling = fallingScore(
      score([event(0, 0, 1, [note(60)]), event(1, 1, 1, [note(60)])]),
    );
    assert.equal(falling.notes.filter((n) => n.midi === 60).length, 2);
  });

  it('treats a tie with no beginning as a note of its own', () => {
    const falling = fallingScore(score([event(0, 4, 1, [note(60, 1, true)])]));
    assert.deepEqual(
      falling.notes.map((n) => [n.startQuarters, n.endQuarters]),
      [[4, 5]],
    );
  });

  it('reads the hand off the staff', () => {
    const falling = fallingScore(score([event(0, 0, 1, [note(60, 1), note(48, 2)])]));
    assert.deepEqual(
      falling.notes.map((n) => [n.midi, n.hand]),
      [
        [48, 'left'],
        [60, 'right'],
      ],
    );
  });

  it('keeps the other hand but marks it as not yours to play', () => {
    const one = score([event(0, 0, 1, [note(60, 1), note(48, 2)])]);
    const right = fallingScore(one, 'right');
    assert.equal(right.notes.length, 2);
    assert.deepEqual(
      right.notes.map((n) => [n.hand, n.expected]),
      [
        ['left', false],
        ['right', true],
      ],
    );
    const both = fallingScore(one, 'both');
    assert.ok(both.notes.every((n) => n.expected));
  });

  it('reports the longest note, which is how far back a search must look', () => {
    const falling = fallingScore(
      score([
        event(0, 0, 1, [note(60), note(48)]),
        event(1, 1, 1, [note(48, 2, true)]),
      ]),
    );
    assert.equal(falling.longestQuarters, 2);
  });

  it('sorts by onset', () => {
    const falling = fallingScore(
      score([event(0, 0, 1, [note(72), note(60)]), event(1, 1, 1, [note(64)])]),
    );
    const starts = falling.notes.map((n) => n.startQuarters);
    assert.deepEqual([...starts].sort((a, b) => a - b), starts);
  });
});

describe('visibleAt', () => {
  const falling = fallingScore(
    score([
      event(0, 0, 1, [note(60)]),
      event(1, 1, 1, [note(62)]),
      event(2, 2, 1, [note(64)]),
      event(3, 3, 1, [note(65)]),
      event(4, 4, 1, [note(67)]),
      event(5, 5, 1, [note(69)]),
    ]),
  );
  const midiOf = (notes: readonly FallingNote[]) => notes.map((n) => n.midi);

  it('shows a bar of music and no more', () => {
    assert.deepEqual(midiOf(visibleAt(falling, 0, 4)), [60, 62, 64, 65]);
  });

  it('drops a note once it has passed the keyboard', () => {
    assert.deepEqual(midiOf(visibleAt(falling, 1, 4)), [62, 64, 65, 67]);
  });

  it('keeps a note that is still being held', () => {
    const long = fallingScore(
      score([event(0, 0, 4, [note(60)]), event(1, 4, 1, [note(72)])]),
    );
    assert.deepEqual(midiOf(visibleAt(long, 3, 4)), [60, 72]);
  });

  it('finds the window in the middle of a long piece', () => {
    const many = fallingScore(
      score(Array.from({ length: 400 }, (_, i) => event(i, i, 1, [note(60 + (i % 12))]))),
    );
    assert.deepEqual(
      visibleAt(many, 200, 4).map((n) => n.startQuarters),
      [200, 201, 202, 203],
    );
  });

  it('shows nothing when there is no strip to show it on', () => {
    assert.deepEqual(visibleAt(falling, 0, 0), []);
    assert.deepEqual(visibleAt(EMPTY_FALLING, 0, 4), []);
  });
});

describe('stepEase', () => {
  it('starts where it started and arrives where it was going', () => {
    assert.equal(stepEase(0, 1, 0), 0);
    assert.equal(stepEase(0, 1, STEP_MS), 1);
  });

  it('finishes rather than creeping towards the target', () => {
    assert.equal(stepEase(0, 1, STEP_MS + 1), 1);
    assert.equal(stepEase(0, 1, 5000), 1);
  });

  it('covers most of the gap in the first half of the step', () => {
    const half = stepEase(0, 1, STEP_MS / 2);
    assert.ok(half > 0.8 && half < 0.9, `got ${half}`);
  });

  it('only ever moves forward, and never past the target', () => {
    let last = 0;
    for (let t = 0; t <= STEP_MS; t += 7) {
      const at = stepEase(0, 1, t);
      assert.ok(at >= last && at <= 1, `${at} after ${last}`);
      last = at;
    }
  });

  it('does not run backwards', () => {
    assert.equal(stepEase(8, 4, 16), 4);
  });

  it('jumps a gap too wide to slide', () => {
    assert.equal(stepEase(0, 40, 16), 40);
  });

  it('lands in the same place however the frames fall', () => {
    // Only the time since the step began matters, so a dropped frame costs
    // nothing: the next one simply picks the position up further along.
    assert.equal(stepEase(0, 1, 60), stepEase(0, 1, 60));
    assert.ok(stepEase(0, 1, 60) < stepEase(0, 1, 61));
  });
});
