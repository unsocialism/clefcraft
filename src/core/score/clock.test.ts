import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { beatQuartersFor, countInQuartersFor, readClock } from './clock.ts';

const in44 = (elapsedQuarters: number, startQuarters = 0) =>
  readClock({
    elapsedQuarters,
    startQuarters,
    countInQuarters: countInQuartersFor(4, 4),
    beatQuarters: beatQuartersFor(4),
    beatsPerBar: 4,
  });

describe('the beat, from the time signature', () => {
  it('counts quarters in 4/4 and eighths in 6/8', () => {
    assert.equal(beatQuartersFor(4), 1);
    assert.equal(beatQuartersFor(8), 0.5);
    assert.equal(beatQuartersFor(2), 2);
  });

  it('counts in for one bar of whatever the meter is', () => {
    assert.equal(countInQuartersFor(4, 4), 4);
    assert.equal(countInQuartersFor(3, 4), 3);
    assert.equal(countInQuartersFor(6, 8), 3);
  });
});

describe('reading the play-along clock', () => {
  it('holds the music still through the count-in, counting the beats', () => {
    assert.deepEqual(in44(0), {
      quarters: 0,
      countingIn: true,
      beat: 1,
      beatPhase: 0,
      countInProgress: 0,
      countInQuarters: 4,
    });
    assert.equal(in44(1.5).beat, 2);
    assert.equal(in44(1.5).beatPhase, 0.5);
    assert.equal(in44(3.99).beat, 4);
    assert.equal(in44(2).countingIn, true);
  });

  it('starts the music the moment the count-in ends, on beat one', () => {
    const started = in44(4);
    assert.equal(started.countingIn, false);
    assert.equal(started.quarters, 0);
    assert.equal(started.beat, 1);
    assert.equal(started.beatPhase, 0);
    assert.equal(in44(6).quarters, 2, 'and then moves in real time');
    assert.equal(in44(6).beat, 3);
  });

  it('counts in from wherever the cursor stands, not from the top', () => {
    const waiting = in44(1, 12);
    assert.equal(waiting.quarters, 12, 'the line waits at bar four');
    assert.equal(in44(4, 12).quarters, 12);
    assert.equal(in44(5, 12).quarters, 13);
    assert.equal(in44(5, 12).beat, 2, 'and the beat follows the barlines, not the start');
  });

  it('wraps the beat with the bar, in any meter', () => {
    const in68 = (elapsedQuarters: number) =>
      readClock({
        elapsedQuarters,
        startQuarters: 0,
        countInQuarters: countInQuartersFor(6, 8),
        beatQuarters: beatQuartersFor(8),
        beatsPerBar: 6,
      });
    assert.equal(in68(2.5).beat, 6, 'the last beat of the count-in');
    assert.equal(in68(3).beat, 1);
    assert.equal(in68(3 + 2.5).beat, 6);
    assert.equal(in68(3 + 3).beat, 1, 'and round again at the barline');
  });

  it('says how far through the count-in it is, for the line to run up on', () => {
    // The line has to arrive at the first note exactly on the downbeat, so
    // it needs the fraction, not only which beat is being counted.
    assert.equal(in44(0).countInProgress, 0);
    assert.equal(in44(1).countInProgress, 0.25);
    assert.equal(in44(3).countInProgress, 0.75);
    assert.ok(in44(3.999).countInProgress > 0.99);
    assert.equal(in44(4).countInProgress, 1, 'and it is home when the music starts');
    assert.equal(in44(9).countInProgress, 1, 'and stays there');
    assert.equal(in44(2).countInQuarters, 4, 'with the length to run up over');
  });

  it('skips the count-in when there is none', () => {
    const reading = readClock({
      elapsedQuarters: 0,
      startQuarters: 8,
      countInQuarters: 0,
      beatQuarters: 1,
      beatsPerBar: 4,
    });
    assert.equal(reading.countingIn, false);
    assert.equal(reading.quarters, 8);
    assert.equal(reading.beat, 1);
    assert.equal(reading.countInProgress, 1, 'nothing to run up over');
    assert.equal(reading.countInQuarters, 0);
  });

  it('does not go backwards before the clock starts', () => {
    assert.equal(in44(-0.5).quarters, 0);
    assert.equal(in44(-0.5).beat, 1);
  });
});
