import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BLACK_KEY_WIDTH, keyboardLayout } from './keyboard.ts';

describe('keyboardLayout', () => {
  it('builds a standard 88-key board: 52 white, 36 black', () => {
    const layout = keyboardLayout();
    assert.equal(layout.lowest, 21); // A0
    assert.equal(layout.highest, 108); // C8
    assert.equal(layout.whiteKeys.length, 52);
    assert.equal(layout.blackKeys.length, 36);
    assert.equal(layout.width, 52);
  });

  it('lays white keys out edge to edge with no gaps or overlaps', () => {
    const { whiteKeys } = keyboardLayout();
    whiteKeys.forEach((key, i) => {
      assert.equal(key.x, i, `white key ${i} should start at x=${i}`);
      assert.equal(key.width, 1);
    });
  });

  it('puts every black key between its two white neighbours', () => {
    const layout = keyboardLayout();
    const whiteByMidi = new Map(layout.whiteKeys.map((k) => [k.midi, k]));
    for (const black of layout.blackKeys) {
      const left = whiteByMidi.get(black.midi - 1);
      const right = whiteByMidi.get(black.midi + 1);
      assert.ok(left, `no white key below MIDI ${black.midi}`);
      assert.ok(right, `no white key above MIDI ${black.midi}`);
      const centre = black.x + black.width / 2;
      assert.ok(
        centre > left.x && centre < right.x + right.width,
        `MIDI ${black.midi} centre ${centre} is outside its neighbours`,
      );
      // And close to the boundary between them, within the usual nudge.
      assert.ok(Math.abs(centre - right.x) <= 0.15);
    }
  });

  it('never lets two black keys overlap', () => {
    const black = [...keyboardLayout().blackKeys].sort((a, b) => a.x - b.x);
    for (let i = 1; i < black.length; i++) {
      const prev = black[i - 1];
      const cur = black[i];
      assert.ok(prev && cur);
      assert.ok(cur.x >= prev.x + prev.width, `black keys ${prev.midi}/${cur.midi} overlap`);
    }
  });

  it('keeps every key inside the board', () => {
    const layout = keyboardLayout();
    for (const key of [...layout.whiteKeys, ...layout.blackKeys]) {
      assert.ok(key.x >= 0, `MIDI ${key.midi} starts at ${key.x}`);
      assert.ok(key.x + key.width <= layout.width + 1e-9, `MIDI ${key.midi} runs past the end`);
    }
  });

  it('widens a range so the board starts and ends on white keys', () => {
    // C#3 to A#4 should widen outwards to C3 and B4.
    const layout = keyboardLayout(49, 70);
    assert.equal(layout.lowest, 48); // C3
    assert.equal(layout.highest, 71); // B4
  });

  it('supports a smaller 61-key board', () => {
    const layout = keyboardLayout(36, 96); // C2 to C7
    assert.equal(layout.whiteKeys.length + layout.blackKeys.length, 61);
    assert.equal(layout.whiteKeys.length, 36);
  });

  it('uses a black key narrower than a white one', () => {
    assert.ok(BLACK_KEY_WIDTH > 0 && BLACK_KEY_WIDTH < 1);
    for (const key of keyboardLayout().blackKeys) {
      assert.equal(key.width, BLACK_KEY_WIDTH);
      assert.ok(key.height < 1);
    }
  });
});
