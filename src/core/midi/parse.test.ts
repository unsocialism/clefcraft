import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseMidiMessage } from './parse.ts';

describe('parseMidiMessage', () => {
  it('decodes a note-on', () => {
    assert.deepEqual(parseMidiMessage([0x90, 60, 100], 12.5), {
      type: 'noteon',
      note: 60,
      velocity: 100,
      channel: 0,
      time: 12.5,
    });
  });

  it('decodes an explicit note-off', () => {
    assert.deepEqual(parseMidiMessage([0x80, 60, 64]), {
      type: 'noteoff',
      note: 60,
      velocity: 64,
      channel: 0,
      time: 0,
    });
  });

  it('treats note-on with velocity 0 as a note-off', () => {
    // Most keyboards release keys this way, and getting it wrong leaves
    // every note stuck on.
    const event = parseMidiMessage([0x90, 60, 0]);
    assert.equal(event?.type, 'noteoff');
  });

  it('keeps the channel nibble', () => {
    assert.equal(parseMidiMessage([0x95, 60, 100])?.channel, 5);
    assert.equal(parseMidiMessage([0x8f, 60, 0])?.channel, 15);
  });

  it('reads sustain (CC64) as down at 64 and up below it', () => {
    assert.deepEqual(parseMidiMessage([0xb0, 64, 127]), {
      type: 'sustain',
      down: true,
      channel: 0,
      time: 0,
    });
    assert.equal(parseMidiMessage([0xb0, 64, 64])?.type, 'sustain');
    assert.equal((parseMidiMessage([0xb0, 64, 64]) as { down: boolean }).down, true);
    assert.equal((parseMidiMessage([0xb0, 64, 63]) as { down: boolean }).down, false);
    assert.equal((parseMidiMessage([0xb0, 64, 0]) as { down: boolean }).down, false);
  });

  it('maps all-notes-off and all-sound-off to a panic event', () => {
    assert.equal(parseMidiMessage([0xb0, 123, 0])?.type, 'allnotesoff');
    assert.equal(parseMidiMessage([0xb0, 120, 0])?.type, 'allnotesoff');
  });

  it('ignores messages we do not act on', () => {
    assert.equal(parseMidiMessage([0xb0, 7, 100]), null); // volume CC
    assert.equal(parseMidiMessage([0xc0, 5]), null); // program change
    assert.equal(parseMidiMessage([0xd0, 64]), null); // channel aftertouch
    assert.equal(parseMidiMessage([0xa0, 60, 64]), null); // poly aftertouch
    assert.equal(parseMidiMessage([0xe0, 0, 64]), null); // pitch bend
    assert.equal(parseMidiMessage([0xf8]), null); // realtime clock
    assert.equal(parseMidiMessage([0xf0, 0x7e]), null); // sysex
  });

  it('rejects malformed input instead of inventing a note', () => {
    assert.equal(parseMidiMessage([]), null);
    assert.equal(parseMidiMessage([0x90]), null);
    assert.equal(parseMidiMessage([0x90, 60]), null);
    assert.equal(parseMidiMessage([60, 100]), null); // no status byte
  });

  it('accepts a Uint8Array, which is what the browser actually delivers', () => {
    const event = parseMidiMessage(new Uint8Array([0x90, 64, 90]));
    assert.equal(event?.type, 'noteon');
    assert.equal((event as { note: number }).note, 64);
  });
});
