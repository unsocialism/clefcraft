import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_NOTE_STATE, applyEvent, applyEvents, soundingNotes } from './noteState.ts';
import type { MidiEvent } from './midi/types.ts';

const on = (note: number, velocity = 80): MidiEvent => ({ type: 'noteon', note, velocity, channel: 0, time: 0 });
const off = (note: number): MidiEvent => ({ type: 'noteoff', note, velocity: 0, channel: 0, time: 0 });
const pedal = (down: boolean): MidiEvent => ({ type: 'sustain', down, channel: 0, time: 0 });

describe('noteState', () => {
  it('starts empty', () => {
    assert.deepEqual(soundingNotes(EMPTY_NOTE_STATE), []);
  });

  it('tracks held keys and returns them low to high', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [on(67), on(60), on(64)]);
    assert.deepEqual(soundingNotes(state), [60, 64, 67]);
  });

  it('removes a key on release', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [on(60), on(64), off(60)]);
    assert.deepEqual(soundingNotes(state), [64]);
  });

  it('does not mutate the state passed in', () => {
    const before = applyEvents(EMPTY_NOTE_STATE, [on(60)]);
    const snapshot = soundingNotes(before);
    applyEvent(before, on(64));
    assert.deepEqual(soundingNotes(before), snapshot);
  });

  it('ignores a note-off for a key that is not down', () => {
    const state = applyEvent(EMPTY_NOTE_STATE, off(60));
    assert.equal(state, EMPTY_NOTE_STATE);
  });

  it('keeps notes ringing while the sustain pedal is down', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [pedal(true), on(60), off(60), on(64), off(64)]);
    assert.deepEqual(soundingNotes(state), [60, 64]);
  });

  it('clears sustained notes when the pedal lifts, keeping held keys', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [
      pedal(true),
      on(60),
      off(60), // sustained
      on(64), // still held
      pedal(false),
    ]);
    assert.deepEqual(soundingNotes(state), [64]);
  });

  it('re-striking a sustained note makes it a held key again', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [
      pedal(true),
      on(60),
      off(60), // 60 is sustained
      on(60), // struck again while the pedal is still down
      pedal(false), // pedal up must NOT silence it: the key is held
    ]);
    assert.deepEqual(soundingNotes(state), [60]);
  });

  it('does not double-count a re-struck held key', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [on(60, 40), on(60, 120)]);
    assert.deepEqual(soundingNotes(state), [60]);
    assert.equal(state.velocities.get(60), 120);
  });

  it('forgets velocity once a note stops sounding', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [on(60), off(60)]);
    assert.equal(state.velocities.has(60), false);
  });

  it('keeps velocity for a pedal-sustained note', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [pedal(true), on(60, 95), off(60)]);
    assert.equal(state.velocities.get(60), 95);
  });

  it('panics cleanly on all-notes-off but remembers the pedal', () => {
    const state = applyEvents(EMPTY_NOTE_STATE, [
      pedal(true),
      on(60),
      on(64),
      { type: 'allnotesoff', channel: 0, time: 0 },
    ]);
    assert.deepEqual(soundingNotes(state), []);
    assert.equal(state.pedal, true);
  });

  it('is a no-op for a redundant pedal message', () => {
    const down = applyEvent(EMPTY_NOTE_STATE, pedal(true));
    assert.equal(applyEvent(down, pedal(true)), down);
  });

  it('survives a long random stream without leaking notes', () => {
    // Deterministic pseudo-random stream; the invariant is that a state with
    // no keys down and no pedal is silent.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let state = EMPTY_NOTE_STATE;
    const held = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const note = 21 + Math.floor(rand() * 88);
      const roll = rand();
      if (roll < 0.45) {
        state = applyEvent(state, on(note));
        held.add(note);
      } else if (roll < 0.9) {
        state = applyEvent(state, off(note));
        held.delete(note);
      } else {
        state = applyEvent(state, pedal(rand() < 0.5));
      }
      assert.deepEqual([...state.down].sort((a, b) => a - b), [...held].sort((a, b) => a - b));
    }
    state = applyEvent(state, pedal(false));
    for (const note of [...held]) state = applyEvent(state, off(note));
    assert.deepEqual(soundingNotes(state), []);
    assert.equal(state.velocities.size, 0);
  });
});
