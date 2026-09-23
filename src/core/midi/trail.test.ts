import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_TRAIL, momentsOf, trailEvent, type TrailState } from './trail.ts';
import type { MidiEvent } from './types.ts';

const on = (note: number, velocity = 80): MidiEvent => ({
  type: 'noteon',
  note,
  velocity,
  channel: 0,
  time: 0,
});
const off = (note: number): MidiEvent => ({
  type: 'noteoff',
  note,
  velocity: 0,
  channel: 0,
  time: 0,
});

function play(
  script: readonly (readonly [MidiEvent, number])[],
  options = {},
): TrailState {
  let state = EMPTY_TRAIL;
  for (const [event, at] of script) state = trailEvent(state, event, at, options);
  return state;
}

describe('the live trail', () => {
  it('shows a key from the moment it goes down, before it comes up', () => {
    const state = play([[on(60), 1000]]);
    assert.deepEqual(
      state.notes.map((n) => [n.midi, n.startMs, n.endMs]),
      [[60, 1000, null]],
      'a note still held has no end yet — that is what makes it grow',
    );
  });

  it('closes the right one when the same key is struck twice over', () => {
    const state = play([
      [on(60), 0],
      [on(60), 200],
      [off(60), 300],
    ]);
    assert.deepEqual(
      state.notes.map((n) => [n.startMs, n.endMs]),
      [
        [0, null],
        [200, 300],
      ],
      'the newer press is the one that was let go',
    );
  });

  it('forgets what has scrolled out of sight, but never what is still held', () => {
    // Forty notes, so the oldest are past the handful always kept.
    const script: (readonly [MidiEvent, number])[] = [];
    for (let i = 0; i < 40; i++) {
      script.push([on(40 + i), i * 100], [off(40 + i), i * 100 + 50]);
    }
    script.push([on(88), 3900]); // still down at the end
    script.push([on(89), 12_000], [off(89), 12_100]);
    const state = play(script, { keepMs: 5000 });
    const kept = state.notes.map((n) => n.midi);
    assert.ok(!kept.includes(40), 'the note from twelve seconds ago is gone');
    assert.ok(kept.includes(88), 'the one still held is not');
    assert.ok(kept.includes(89));
  });

  it('keeps the last handful however long ago they were played', () => {
    // A phrase, then a long silence. The staff should still show it.
    const state = play(
      [
        [on(60), 0],
        [off(60), 200],
        [on(64), 400],
        [off(64), 600],
        [on(67), 60_000], // a minute later
      ],
      { keepMs: 5000 },
    );
    assert.deepEqual(
      state.notes.map((n) => n.midi),
      [60, 64, 67],
    );
  });

  it('keeps the list bounded however much is played', () => {
    let state = EMPTY_TRAIL;
    for (let i = 0; i < 500; i++) {
      state = trailEvent(state, on(21 + (i % 60)), i * 10, { mostNotes: 50 });
      state = trailEvent(state, off(21 + (i % 60)), i * 10 + 5, { mostNotes: 50 });
    }
    assert.ok(state.notes.length <= 50, `${state.notes.length} notes kept`);
  });

  it('lets go of everything on an all-notes-off', () => {
    const state = play([
      [on(60), 0],
      [on(64), 0],
      [{ type: 'allnotesoff', channel: 0, time: 0 }, 500],
    ]);
    assert.deepEqual(
      state.notes.map((n) => n.endMs),
      [500, 500],
    );
  });

  it('ignores the pedal, which changes the sound and not the playing', () => {
    const state = play([
      [{ type: 'sustain', down: true, channel: 0, time: 0 }, 0],
      [on(60), 100],
    ]);
    assert.equal(state.notes.length, 1);
  });
});

describe('reading the trail as moments', () => {
  it('makes one moment of a chord, whatever order it arrived in', () => {
    const state = play([
      [on(64), 0],
      [on(60), 12],
      [on(67), 30],
    ]);
    const moments = momentsOf(state.notes);
    assert.equal(moments.length, 1);
    assert.deepEqual(moments[0]!.notes, [60, 64, 67], 'low to high, as a chord is read');
    assert.equal(moments[0]!.held, true);
  });

  it('separates notes played one after another', () => {
    const state = play([
      [on(60), 0],
      [off(60), 300],
      [on(62), 400],
      [off(62), 700],
    ]);
    assert.deepEqual(
      momentsOf(state.notes).map((m) => m.notes),
      [[60], [62]],
    );
  });

  it('marks a moment as held only while a key of it is down', () => {
    const state = play([
      [on(60), 0],
      [on(64), 10],
      [off(60), 300],
    ]);
    assert.equal(momentsOf(state.notes)[0]!.held, true, 'one key is still down');
    const both = trailEvent(state, off(64), 400);
    assert.equal(momentsOf(both.notes)[0]!.held, false);
  });

  it('keeps only the last few, oldest dropped first', () => {
    let state = EMPTY_TRAIL;
    for (let i = 0; i < 12; i++) {
      state = trailEvent(state, on(60 + i), i * 500);
      state = trailEvent(state, off(60 + i), i * 500 + 200);
    }
    const moments = momentsOf(state.notes, 4);
    assert.deepEqual(
      moments.map((m) => m.notes[0]),
      [68, 69, 70, 71],
    );
  });

  it('gives each moment a name of its own that does not change', () => {
    const first = play([[on(60), 0]]);
    const later = trailEvent(trailEvent(first, on(64), 1000), on(67), 2000);
    assert.equal(momentsOf(first.notes)[0]!.id, momentsOf(later.notes)[0]!.id);
    assert.equal(new Set(momentsOf(later.notes).map((m) => m.id)).size, 3);
  });

  it('has nothing to show before anything is played', () => {
    assert.deepEqual(momentsOf([]), []);
  });
});
