import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PRACTICE_OPTIONS,
  advanceToTime,
  attemptExpiresIn,
  expireAttempt,
  currentEvent,
  pressNote,
  scoreLengthQuarters,
  seekToMeasure,
  startPractice,
  upcoming,
  type PracticeOptions,
  type PracticeState,
} from './practiceEngine.ts';
import { C_MAJOR_SCALE, TWO_HAND_DEMO, buildScore } from './testScores.ts';
import { expectedNotes } from './types.ts';

const WAIT = DEFAULT_PRACTICE_OPTIONS;
const STRICT: PracticeOptions = { mode: 'wait', requireClean: true, chordWindowMs: null };
const TEMPO: PracticeOptions = { mode: 'tempo', requireClean: false, chordWindowMs: null };

const play = (
  score: typeof C_MAJOR_SCALE,
  state: PracticeState,
  notes: readonly number[],
  options: PracticeOptions = WAIT,
) => notes.reduce((s, midi) => pressNote(score, s, midi, options), state);

describe('wait mode', () => {
  it('starts on the first note', () => {
    const state = startPractice(C_MAJOR_SCALE);
    assert.equal(state.index, 0);
    assert.equal(state.finished, false);
    assert.deepEqual([...expectedNotes(currentEvent(C_MAJOR_SCALE, state)!)], [60]);
  });

  it('advances when the expected note is played', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = pressNote(C_MAJOR_SCALE, state, 60);
    assert.equal(state.index, 1);
    assert.equal(state.totalMistakes, 0);
  });

  it('does not advance on a wrong note, and counts it', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = pressNote(C_MAJOR_SCALE, state, 61);
    assert.equal(state.index, 0, 'cursor must not move');
    assert.equal(state.totalMistakes, 1);
    assert.equal(state.wrongHere, 1);
  });

  it('treats a note from the next event played early as a mistake', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = pressNote(C_MAJOR_SCALE, state, 62); // the second note of the scale
    assert.equal(state.index, 0);
    assert.equal(state.totalMistakes, 1);
  });

  it('plays a whole scale through to the end', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = play(C_MAJOR_SCALE, state, [60, 62, 64, 65, 67, 69, 71, 72]);
    assert.equal(state.finished, true);
    assert.equal(state.totalMistakes, 0);
    assert.equal(state.cleanEvents, 8);
    assert.equal(currentEvent(C_MAJOR_SCALE, state), null);
  });

  it('ignores further notes once the piece is finished', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = play(C_MAJOR_SCALE, state, [60, 62, 64, 65, 67, 69, 71, 72]);
    const after = pressNote(C_MAJOR_SCALE, state, 60);
    assert.equal(after, state);
  });
});

describe('chords', () => {
  it('waits for every note of a chord, in any order', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [64, 36, 67]);
    assert.equal(state.index, 0, 'still on the first chord');
    state = pressNote(TWO_HAND_DEMO, state, 60);
    assert.equal(state.index, 1, 'chord complete, cursor moves');
  });

  it('does not count a re-struck note as progress', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [60, 60, 60, 60]);
    assert.equal(state.index, 0);
    assert.equal(state.struck.size, 1);
    assert.equal(state.totalMistakes, 0, 'a repeat is not a wrong note');
  });

  it('keeps partial progress through a wrong note by default', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [60, 64, 61]); // 61 is wrong
    assert.equal(state.struck.size, 2, 'the two correct notes still count');
    state = play(TWO_HAND_DEMO, state, [67, 36]);
    assert.equal(state.index, 1);
    assert.equal(state.totalMistakes, 1);
  });

  it('restarts the chord on a wrong note in strict mode', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [60, 64, 61], STRICT);
    assert.equal(state.struck.size, 0, 'progress cleared');
    state = play(TWO_HAND_DEMO, state, [60, 64, 67, 36], STRICT);
    assert.equal(state.index, 1);
  });

  it('marks an event with a mistake as not clean', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [61, 60, 64, 67, 36]);
    assert.equal(state.index, 1);
    assert.equal(state.cleanEvents, 0);
    assert.equal(state.wrongHere, 0, 'the counter resets for the new event');
    assert.equal(state.totalMistakes, 1, 'but the total is kept');
  });
});

describe('tied notes', () => {
  const tied = buildScore([
    { notes: [60, 64] },
    { notes: [{ midi: 60, tied: true }, { midi: 65 }] }, // only 65 is struck
    { notes: [{ midi: 60, tied: true }, { midi: 64, tied: true }] }, // nothing struck
    { notes: [67] },
  ]);

  it('only expects notes that are actually struck', () => {
    let state = startPractice(tied);
    state = play(tied, state, [60, 64]);
    assert.equal(state.index, 1);
    state = pressNote(tied, state, 65);
    assert.equal(state.index, 3, 'the all-tied event is skipped, not stranded');
  });

  it('does not treat a held tied note as a mistake when re-struck', () => {
    let state = startPractice(tied);
    state = play(tied, state, [60, 64]);
    const before = state.totalMistakes;
    state = pressNote(tied, state, 60); // tied over, not expected
    assert.equal(state.totalMistakes, before + 1);
    // Documented behaviour: re-striking a tied note IS flagged. Worth
    // revisiting if it proves annoying in real playing.
  });

  it('finishes when only tied events remain', () => {
    const trailing = buildScore([{ notes: [60] }, { notes: [{ midi: 60, tied: true }] }]);
    let state = startPractice(trailing);
    state = pressNote(trailing, state, 60);
    assert.equal(state.finished, true);
  });

  it('reports a fully tied score as finished from the start', () => {
    const allTied = buildScore([{ notes: [{ midi: 60, tied: true }] }]);
    assert.equal(startPractice(allTied).finished, true);
  });
});

describe('tempo mode', () => {
  it('moves the cursor by elapsed time, not by playing', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = advanceToTime(C_MAJOR_SCALE, state, 3.0);
    assert.equal(state.index, 3, 'four quarter notes in, we are on the fourth');
  });

  it('does not advance when the right note is played', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = pressNote(C_MAJOR_SCALE, state, 60, TEMPO);
    assert.equal(state.index, 0, 'the clock owns the cursor');
    assert.equal(state.struck.size, 1);
  });

  it('still scores wrong notes', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = pressNote(C_MAJOR_SCALE, state, 61, TEMPO);
    assert.equal(state.totalMistakes, 1);
  });

  it('hands the same state back when the clock has not reached the next note', () => {
    // The clock asks every frame; an unchanged answer must be the same
    // object, or the app re-renders sixty times a second for nothing.
    const state = startPractice(C_MAJOR_SCALE);
    assert.equal(advanceToTime(C_MAJOR_SCALE, state, 0.1), state);
    assert.equal(advanceToTime(C_MAJOR_SCALE, state, 0.9), state);
    assert.notEqual(advanceToTime(C_MAJOR_SCALE, state, 1), state, 'but not once it has');
    assert.notEqual(
      advanceToTime(C_MAJOR_SCALE, state, 99),
      state,
      'nor when the piece finishes under a held note',
    );
  });

  it('clears progress when the clock moves on', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = pressNote(C_MAJOR_SCALE, state, 60, TEMPO);
    state = advanceToTime(C_MAJOR_SCALE, state, 1.0);
    assert.equal(state.index, 1);
    assert.equal(state.struck.size, 0);
  });

  it('finishes at the end of the last note, not at its onset', () => {
    const length = scoreLengthQuarters(C_MAJOR_SCALE);
    assert.equal(length, 8);
    let state = startPractice(C_MAJOR_SCALE);
    state = advanceToTime(C_MAJOR_SCALE, state, 7.5);
    assert.equal(state.finished, false, 'the last note is still sounding');
    state = advanceToTime(C_MAJOR_SCALE, state, 8);
    assert.equal(state.finished, true);
  });

  it('handles events longer than a quarter note', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = advanceToTime(TWO_HAND_DEMO, state, 1.9);
    assert.equal(state.index, 0);
    state = advanceToTime(TWO_HAND_DEMO, state, 2.0);
    assert.equal(state.index, 1);
  });

  it('is stable when called repeatedly with the same time', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = advanceToTime(C_MAJOR_SCALE, state, 2.0);
    const again = advanceToTime(C_MAJOR_SCALE, state, 2.0);
    assert.equal(again.index, state.index);
  });
});

describe('lookahead', () => {
  it('reports the current event and the next two', () => {
    const state = startPractice(C_MAJOR_SCALE);
    const ahead = upcoming(C_MAJOR_SCALE, state, 3);
    assert.deepEqual(ahead.map((u) => u.distance), [0, 1, 2]);
    assert.deepEqual(ahead.map((u) => u.remaining), [[60], [62], [64]]);
  });

  it('drops notes already struck from the current event', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [60, 64]);
    const [now] = upcoming(TWO_HAND_DEMO, state, 2);
    assert.ok(now);
    assert.deepEqual(now.remaining, [36, 67], 'only what is left to play');
  });

  it('shows all notes of future events, struck or not', () => {
    let state = startPractice(TWO_HAND_DEMO);
    state = play(TWO_HAND_DEMO, state, [60]);
    const ahead = upcoming(TWO_HAND_DEMO, state, 2);
    assert.deepEqual(ahead[1]?.remaining, [43, 65, 69]);
  });

  it('runs short near the end rather than padding', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = play(C_MAJOR_SCALE, state, [60, 62, 64, 65, 67, 69]);
    assert.equal(upcoming(C_MAJOR_SCALE, state, 4).length, 2);
  });

  it('is empty once finished', () => {
    let state = startPractice(C_MAJOR_SCALE);
    state = play(C_MAJOR_SCALE, state, [60, 62, 64, 65, 67, 69, 71, 72]);
    assert.deepEqual(upcoming(C_MAJOR_SCALE, state, 3), []);
  });
});

describe('seeking', () => {
  it('jumps to a measure and resets the score counters', () => {
    const state = seekToMeasure(C_MAJOR_SCALE, 2);
    assert.equal(state.index, 4, 'measure 2 starts at the fifth quarter note');
    assert.equal(state.totalMistakes, 0);
    assert.equal(state.finished, false);
  });

  it('finishes when seeking past the end', () => {
    assert.equal(seekToMeasure(C_MAJOR_SCALE, 99).finished, true);
  });
});

describe('an empty score', () => {
  const empty = buildScore([]);

  it('is finished immediately and never throws', () => {
    const state = startPractice(empty);
    assert.equal(state.finished, true);
    assert.equal(currentEvent(empty, state), null);
    assert.deepEqual(upcoming(empty, state), []);
    assert.equal(pressNote(empty, state, 60), state);
    assert.equal(scoreLengthQuarters(empty), 0);
  });
});

describe('immutability', () => {
  it('never mutates the state handed in', () => {
    const state = startPractice(TWO_HAND_DEMO);
    const snapshot = { index: state.index, struck: [...state.struck], mistakes: state.totalMistakes };
    pressNote(TWO_HAND_DEMO, state, 60);
    pressNote(TWO_HAND_DEMO, state, 61);
    advanceToTime(TWO_HAND_DEMO, state, 5);
    assert.equal(state.index, snapshot.index);
    assert.deepEqual([...state.struck], snapshot.struck);
    assert.equal(state.totalMistakes, snapshot.mistakes);
  });
});

describe('chord timing window', () => {
  const WINDOWED: PracticeOptions = { mode: 'wait', requireClean: false, chordWindowMs: 120 };
  const chord = buildScore([{ notes: [60, 64, 67] }, { notes: [72] }]);

  /** Play notes at explicit timestamps, in milliseconds. */
  const playAt = (
    state: PracticeState,
    events: readonly (readonly [number, number])[],
    options: PracticeOptions = WINDOWED,
  ) => events.reduce((s, [midi, at]) => pressNote(chord, s, midi, options, at), state);

  it('accepts a chord struck inside the window', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1030], [67, 1080]]);
    assert.equal(state.index, 1, 'all three within 120ms');
  });

  it('accepts notes landing exactly on the window boundary', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1060], [67, 1120]]);
    assert.equal(state.index, 1, '120ms after the first note is still inside');
  });

  it('does not complete a chord rolled out too slowly', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1400], [67, 1800]]);
    assert.equal(state.index, 0, 'an arpeggio must not satisfy a chord');
  });

  it('treats a late note as the start of a fresh attempt, not a mistake', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1400]]);
    assert.equal(state.totalMistakes, 0, 'being slow is not playing the wrong note');
    assert.deepEqual([...state.struck], [64], 'the late note begins the new attempt');
  });

  it('lets a retry after a failed attempt succeed', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1400]]); // too slow, restarts on 64
    state = playAt(state, [[60, 1420], [67, 1450]]); // 64 + 60 + 67 all within 120ms of 1400
    assert.equal(state.index, 1);
    assert.equal(state.totalMistakes, 0);
  });

  it('measures the window from the first note of the attempt, not the last', () => {
    // 60ms apart each, but 180ms from first to last: outside a 120ms window.
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1060], [67, 1180]]);
    assert.equal(state.index, 0, 'a creeping roll must not sneak through');
  });

  it('never blocks a single-note event', () => {
    const melody = buildScore([{ notes: [60] }, { notes: [62] }]);
    let state = startPractice(melody);
    state = pressNote(melody, state, 60, WINDOWED, 1000);
    state = pressNote(melody, state, 62, WINDOWED, 99_000);
    assert.equal(state.finished, true, 'timing between separate notes is not a chord window');
  });

  it('is disabled by a null window', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 0], [64, 50_000], [67, 90_000]], DEFAULT_PRACTICE_OPTIONS);
    assert.equal(state.index, 1);
  });

  it('treats a missing window field as no window, not as a shut one', () => {
    // A caller built from an older options shape. Silently refusing every
    // chord would be the worst possible failure here.
    const legacy = { mode: 'wait', requireClean: false } as unknown as PracticeOptions;
    let state = startPractice(chord);
    state = playAt(state, [[60, 0], [64, 9_000], [67, 30_000]], legacy);
    assert.equal(state.index, 1);
  });

  it('treats an infinite window as no window', () => {
    const forever: PracticeOptions = { mode: 'wait', requireClean: false, chordWindowMs: Infinity };
    let state = startPractice(chord);
    state = playAt(state, [[60, 0], [64, 9_000], [67, 30_000]], forever);
    assert.equal(state.index, 1);
  });

  it('resets the attempt clock when the cursor moves on', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [64, 1010], [67, 1020]]);
    assert.equal(state.chordStartedAt, null, 'a new event starts with no attempt in flight');
    state = pressNote(chord, state, 72, WINDOWED, 99_000);
    assert.equal(state.finished, true, 'the stale clock must not block the next event');
  });

  it('still counts wrong notes while a window is open', () => {
    let state = startPractice(chord);
    state = playAt(state, [[60, 1000], [61, 1020], [64, 1040], [67, 1060]]);
    assert.equal(state.totalMistakes, 1);
    assert.equal(state.index, 1, 'the wrong note did not stop the chord completing');
  });
});

describe('abandoning a stale chord attempt', () => {
  const WINDOWED: PracticeOptions = { mode: 'wait', requireClean: false, chordWindowMs: 120 };
  const triad = buildScore([{ notes: [60, 64, 67] }, { notes: [72] }]);

  it('reports when the current attempt runs out', () => {
    let state = startPractice(triad);
    assert.equal(attemptExpiresIn(state, WINDOWED, 1000), null, 'nothing in flight yet');
    state = pressNote(triad, state, 60, WINDOWED, 1000);
    assert.equal(attemptExpiresIn(state, WINDOWED, 1000), 120);
    assert.equal(attemptExpiresIn(state, WINDOWED, 1090), 30);
    assert.equal(attemptExpiresIn(state, WINDOWED, 1200), 0, 'never reports a negative delay');
  });

  it('reports nothing to expire when no window applies', () => {
    let state = startPractice(triad);
    state = pressNote(triad, state, 60, DEFAULT_PRACTICE_OPTIONS, 1000);
    assert.equal(attemptExpiresIn(state, DEFAULT_PRACTICE_OPTIONS, 5000), null);
  });

  it('puts the un-played keys back when the attempt expires', () => {
    let state = startPractice(triad);
    state = pressNote(triad, state, 60, WINDOWED, 1000);
    assert.deepEqual(upcoming(triad, state, 1)[0]?.remaining, [64, 67], 'only two left mid-attempt');

    state = expireAttempt(state);
    assert.deepEqual(
      upcoming(triad, state, 1)[0]?.remaining,
      [60, 64, 67],
      'after the window closes the whole chord is required again',
    );
    assert.equal(state.chordStartedAt, null);
  });

  it('does not move the cursor or invent a mistake when it expires', () => {
    let state = startPractice(triad);
    state = pressNote(triad, state, 60, WINDOWED, 1000);
    const expired = expireAttempt(state);
    assert.equal(expired.index, 0);
    assert.equal(expired.totalMistakes, 0);
    assert.equal(expired.finished, false);
  });

  it('is a no-op when there is nothing in flight', () => {
    const state = startPractice(triad);
    assert.equal(expireAttempt(state), state);
  });

  it('lets the chord be played cleanly after an expiry', () => {
    let state = startPractice(triad);
    state = pressNote(triad, state, 60, WINDOWED, 1000);
    state = expireAttempt(state);
    state = pressNote(triad, state, 60, WINDOWED, 5000);
    state = pressNote(triad, state, 64, WINDOWED, 5020);
    state = pressNote(triad, state, 67, WINDOWED, 5040);
    assert.equal(state.index, 1);
    assert.equal(state.totalMistakes, 0);
  });
});

describe('the press log', () => {
  const WINDOWED: PracticeOptions = { mode: 'wait', requireClean: false, chordWindowMs: 120 };
  const triad = buildScore([{ notes: [60, 64, 67] }]);

  it('records correct, wrong, repeated and restarted presses', () => {
    let state = startPractice(triad);
    state = pressNote(triad, state, 60, WINDOWED, 1000); // correct
    state = pressNote(triad, state, 61, WINDOWED, 1010); // wrong
    state = pressNote(triad, state, 60, WINDOWED, 1020); // repeat
    state = pressNote(triad, state, 64, WINDOWED, 9000); // too late -> restarted
    assert.deepEqual(
      state.recent.map((r) => [r.midi, r.verdict]),
      [
        [64, 'restarted'],
        [60, 'repeat'],
        [61, 'wrong'],
        [60, 'correct'],
      ],
      'newest first',
    );
  });

  it('keeps the log bounded', () => {
    let state = startPractice(triad);
    for (let i = 0; i < 40; i++) state = pressNote(triad, state, 61, WINDOWED, 1000 + i);
    assert.equal(state.recent.length, 8);
  });

  it('starts empty and resets on restart', () => {
    let state = startPractice(triad);
    assert.deepEqual(state.recent, []);
    state = pressNote(triad, state, 61, WINDOWED, 1000);
    assert.equal(state.recent.length, 1);
    assert.deepEqual(startPractice(triad).recent, []);
  });
});
