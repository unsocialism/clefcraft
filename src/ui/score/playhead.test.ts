import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { anchorsFrom, playheadAt, type TimeMap } from './playhead.ts';

/** Two bars of 4/4, the second one on the line below. */
const MAP: TimeMap = [
  {
    startQuarters: 0,
    endQuarters: 4,
    top: 10,
    bottom: 150,
    anchors: [
      { quarters: 0, x: 100 },
      { quarters: 2, x: 200 },
      { quarters: 4, x: 400 },
    ],
  },
  {
    startQuarters: 4,
    endQuarters: 8,
    top: 260,
    bottom: 400,
    anchors: [
      { quarters: 4, x: 50 },
      { quarters: 7, x: 150 },
      { quarters: 8, x: 250 },
    ],
  },
];

describe('placing the sweeping line', () => {
  it('sits on a note when the note is due', () => {
    assert.deepEqual(playheadAt(MAP, 0), { x: 100, top: 10, bottom: 150 });
    assert.deepEqual(playheadAt(MAP, 2), { x: 200, top: 10, bottom: 150 });
  });

  it('glides between notes rather than jumping', () => {
    assert.equal(playheadAt(MAP, 1)!.x, 150, 'halfway in time is halfway in space');
    assert.equal(playheadAt(MAP, 3)!.x, 300);
    assert.equal(playheadAt(MAP, 2.5)!.x, 250);
  });

  it('follows the music onto the next line', () => {
    const spot = playheadAt(MAP, 5.5)!;
    assert.equal(spot.top, 260, 'the second bar is on the line below');
    assert.equal(spot.x, 100, 'and it starts again from the left');
  });

  it('spaces by where the notes were drawn, not by the clock alone', () => {
    // The second bar's notes are unevenly spaced: 3 quarters over 100 units,
    // then 1 quarter over 100. A line sweeping the bar at a constant speed
    // would be at 150 here; following the notes puts it two thirds of the
    // way through the first gap instead.
    assert.ok(Math.abs(playheadAt(MAP, 6)!.x - (50 + (100 * 2) / 3)) < 1e-9);
  });

  it('clamps to the ends instead of running off the page', () => {
    assert.deepEqual(playheadAt(MAP, -3), { x: 100, top: 10, bottom: 150 });
    assert.deepEqual(playheadAt(MAP, 99), { x: 250, top: 260, bottom: 400 });
  });

  it('has nowhere to be when nothing is engraved', () => {
    assert.equal(playheadAt([], 1), null);
    assert.equal(
      playheadAt([{ startQuarters: 0, endQuarters: 4, top: 0, bottom: 10, anchors: [] }], 1),
      null,
    );
  });
});

describe("gathering a bar's anchors", () => {
  it('keeps one point per moment, at the leftmost of the two hands', () => {
    const anchors = anchorsFrom(
      [
        { quarters: 0, x: 120 },
        { quarters: 0, x: 118 },
        { quarters: 1, x: 200 },
      ],
      { quarters: 4, x: 400 },
    );
    assert.deepEqual(anchors, [
      { quarters: 0, x: 118 },
      { quarters: 1, x: 200 },
      { quarters: 4, x: 400 },
    ]);
  });

  it('sorts by time and ends at the barline', () => {
    const anchors = anchorsFrom(
      [
        { quarters: 3, x: 300 },
        { quarters: 1, x: 150 },
      ],
      { quarters: 4, x: 400 },
    );
    assert.deepEqual(
      anchors.map((a) => a.quarters),
      [1, 3, 4],
    );
  });

  it('drops anything at or past the barline, which the barline speaks for', () => {
    // A tie's tail can be written at the bar end; two points at the same
    // moment would make the line jump backwards.
    const anchors = anchorsFrom(
      [
        { quarters: 0, x: 100 },
        { quarters: 4, x: 380 },
        { quarters: 5, x: 500 },
      ],
      { quarters: 4, x: 400 },
    );
    assert.deepEqual(anchors, [
      { quarters: 0, x: 100 },
      { quarters: 4, x: 400 },
    ]);
  });

  it('ignores points the engraver could not place', () => {
    const anchors = anchorsFrom(
      [
        { quarters: 0, x: Number.NaN },
        { quarters: 1, x: 200 },
      ],
      { quarters: 4, x: 400 },
    );
    assert.deepEqual(
      anchors.map((a) => a.quarters),
      [1, 4],
    );
  });
});
