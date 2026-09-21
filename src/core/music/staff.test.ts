import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assignClef, toGrandStaffNotes } from './staff.ts';

describe('assignClef', () => {
  it('puts middle C and above on the treble stave', () => {
    assert.equal(assignClef(60), 'treble');
    assert.equal(assignClef(72), 'treble');
  });

  it('puts everything below middle C on the bass stave', () => {
    assert.equal(assignClef(59), 'bass');
    assert.equal(assignClef(21), 'bass');
  });

  it('honours a custom split point', () => {
    assert.equal(assignClef(60, 65), 'bass');
    assert.equal(assignClef(65, 65), 'treble');
  });
});

describe('toGrandStaffNotes', () => {
  it('splits a two-handed chord across the staves', () => {
    // C major triad in the right hand, octave C's in the left.
    const { treble, bass } = toGrandStaffNotes([36, 48, 60, 64, 67]);
    assert.deepEqual(treble.map((n) => n.key), ['c/4', 'e/4', 'g/4']);
    assert.deepEqual(bass.map((n) => n.key), ['c/2', 'c/3']);
  });

  it('sorts notes low to high regardless of input order', () => {
    const { treble } = toGrandStaffNotes([67, 60, 64]);
    assert.deepEqual(treble.map((n) => n.key), ['c/4', 'e/4', 'g/4']);
  });

  it('leaves a stave empty rather than borrowing notes', () => {
    const { treble, bass } = toGrandStaffNotes([60, 64, 67]);
    assert.equal(bass.length, 0);
    assert.equal(treble.length, 3);
  });

  it('marks only the accidentals the key signature does not already imply', () => {
    // D major (2 sharps: F#, C#). F#4 needs no accidental; G#4 does.
    const { treble } = toGrandStaffNotes([66, 68], { fifths: 2 });
    assert.deepEqual(
      treble.map((n) => [n.key, n.accidental]),
      [
        ['f#/4', null],
        ['g#/4', '#'],
      ],
    );
  });

  it('draws a natural when a note cancels the key signature', () => {
    // B flat major (2 flats: B, E). B natural must show a natural sign.
    const { treble } = toGrandStaffNotes([71], { fifths: -2 });
    assert.deepEqual(treble.map((n) => [n.key, n.accidental]), [['b/4', 'n']]);
  });

  it('spells with flats in flat keys', () => {
    const { treble } = toGrandStaffNotes([63, 66], { fifths: -3 });
    assert.deepEqual(treble.map((n) => n.key), ['eb/4', 'gb/4']);
  });

  it('handles the full 88-key range without throwing', () => {
    const all = Array.from({ length: 88 }, (_, i) => 21 + i);
    for (let fifths = -7; fifths <= 7; fifths++) {
      const { treble, bass } = toGrandStaffNotes(all, { fifths });
      assert.equal(treble.length + bass.length, 88);
      for (const note of [...treble, ...bass]) {
        assert.match(note.key, /^[a-g](#|b)?\/-?\d+$/);
      }
    }
  });
});
