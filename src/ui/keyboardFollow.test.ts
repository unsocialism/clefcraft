import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { followScroll, moreBeyond, union } from './keyboardFollow.ts';

const view = (scrollLeft: number, width = 400) => ({ scrollLeft, width });

describe('holding two spans together', () => {
  it('gives back the one that exists when there is only one', () => {
    const only = { left: 10, right: 40 };
    assert.deepEqual(union(only, undefined), only);
    assert.deepEqual(union(undefined, only), only);
    assert.equal(union(undefined, undefined), undefined);
  });

  it('reaches from the leftmost edge to the rightmost', () => {
    assert.deepEqual(union({ left: 100, right: 130 }, { left: 40, right: 60 }), {
      left: 40,
      right: 130,
    });
  });
});

describe('following the keys that matter', () => {
  it('stays put when everything is comfortably in view', () => {
    const at = followScroll(view(200), { left: 300, right: 340 }, { left: 300, right: 340 });
    assert.equal(at, undefined);
  });

  it('stays put when there is nothing to follow', () => {
    assert.equal(followScroll(view(200)), undefined);
  });

  it('centres a key that is off the right-hand edge', () => {
    const at = followScroll(view(0), undefined, { left: 900, right: 930 });
    assert.equal(at, 915 - 200);
  });

  it('centres a key that is off the left-hand edge', () => {
    const at = followScroll(view(600), undefined, { left: 120, right: 150 });
    assert.equal(at, 135 - 200);
  });

  it('counts a key under the margin as out of view', () => {
    // Its left edge is 10px into the window: on screen, but only just, and
    // the next note along would be past the edge.
    const at = followScroll(view(100), undefined, { left: 110, right: 140 });
    assert.notEqual(at, undefined);
  });

  it('keeps a hand-scrolled position while you play inside it', () => {
    const scrolled = view(340);
    for (const key of [{ left: 400, right: 430 }, { left: 600, right: 640 }]) {
      assert.equal(followScroll(scrolled, undefined, key), undefined);
    }
  });

  it('holds the guide and the played key in one window where it can', () => {
    const at = followScroll(view(0), { left: 700, right: 740 }, { left: 800, right: 830 });
    assert.equal(at, (700 + 830) / 2 - 200);
  });

  it('shows what is asked for rather than a midpoint holding neither', () => {
    // A wrong note two octaves down: the pair cannot fit, so the guide wins.
    const at = followScroll(view(0), { left: 900, right: 940 }, { left: 100, right: 130 });
    assert.equal(at, 920 - 200);
  });

  it('follows what you played when nothing is being asked for', () => {
    const at = followScroll(view(0), undefined, { left: 900, right: 930 });
    assert.equal(at, 915 - 200);
  });
});

describe('saying where the keyboard carries on', () => {
  it('says nothing when the whole keyboard fits', () => {
    assert.equal(moreBeyond(0, 900, 900), 'none');
  });

  it('points right from the low end and left from the high end', () => {
    assert.equal(moreBeyond(0, 400, 900), 'right');
    assert.equal(moreBeyond(500, 400, 900), 'left');
  });

  it('points both ways in the middle', () => {
    assert.equal(moreBeyond(200, 400, 900), 'both');
  });

  it('does not claim more over a pixel or two of slack', () => {
    assert.equal(moreBeyond(2, 400, 900), 'right');
    assert.equal(moreBeyond(498, 400, 900), 'left');
  });
});
