import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  frequencyOf,
  isBlackKey,
  noteName,
  spellNote,
  vexflowAccidental,
  vexflowKey,
} from './pitch.ts';
import { keyAlterations } from './keySignature.ts';

const name = (midi: number, fifths = 0) => noteName(spellNote(midi, fifths));

describe('spellNote: anchors', () => {
  it('puts middle C at C4 (MIDI 60)', () => {
    assert.equal(name(60), 'C4');
  });

  it('puts concert A at A4 (MIDI 69)', () => {
    assert.equal(name(69), 'A4');
  });

  it('spans the 88-key range as A0 to C8', () => {
    assert.equal(name(21), 'A0');
    assert.equal(name(108), 'C8');
  });

  it('changes octave between B and C, not at A', () => {
    assert.equal(name(59), 'B3');
    assert.equal(name(60), 'C4');
    assert.equal(name(71), 'B4');
    assert.equal(name(72), 'C5');
  });
});

describe('spellNote: key-aware enharmonics', () => {
  it('uses sharps in C major by default', () => {
    assert.equal(name(61), 'C♯4');
    assert.equal(name(66), 'F♯4');
  });

  it('uses flats in flat keys', () => {
    // E flat major (3 flats)
    assert.equal(name(61, -3), 'D♭4');
    assert.equal(name(66, -3), 'G♭4');
    assert.equal(name(63, -3), 'E♭4');
  });

  it('spells a raised fourth as a natural, not a diminished-second letter', () => {
    // F major: MIDI 71 is B natural (the raised 4th), never C flat.
    assert.equal(name(71, -1), 'B4');
    // G major: MIDI 65 is F natural (the lowered 7th), never E sharp.
    assert.equal(name(65, 1), 'F4');
  });

  it('spells every diatonic degree of E major without an accidental clash', () => {
    // E major = 4 sharps: F#, C#, G#, D#
    const scale = [64, 66, 68, 69, 71, 73, 75].map((m) => name(m, 4));
    assert.deepEqual(scale, ['E4', 'F♯4', 'G♯4', 'A4', 'B4', 'C♯5', 'D♯5']);
  });

  it('spells every diatonic degree of A flat major', () => {
    // A flat major = 4 flats: B, E, A, D
    const scale = [68, 70, 72, 73, 75, 77, 79].map((m) => name(m, -4));
    assert.deepEqual(scale, ['A♭4', 'B♭4', 'C5', 'D♭5', 'E♭5', 'F5', 'G5']);
  });

  it('honours an explicit accidental preference over the key', () => {
    assert.equal(noteName(spellNote(61, 0, 'flats')), 'D♭4');
    assert.equal(noteName(spellNote(61, 0, 'sharps')), 'C♯4');
  });
});

describe('spellNote: invariants across every key and pitch', () => {
  it('always round-trips to the original MIDI number', () => {
    const naturalPc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (let midi = 21; midi <= 108; midi++) {
        const s = spellNote(midi, fifths);
        const pc = naturalPc[s.step];
        assert.notEqual(pc, undefined);
        const reconstructed = (pc as number) + s.alter + 12 * (s.octave + 1);
        assert.equal(
          reconstructed,
          midi,
          `fifths=${fifths} midi=${midi} spelled ${noteName(s)} reconstructs to ${reconstructed}`,
        );
      }
    }
  });

  it('never needs a double accidental', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (let midi = 21; midi <= 108; midi++) {
        const { alter } = spellNote(midi, fifths);
        assert.ok(alter === -1 || alter === 0 || alter === 1);
      }
    }
  });

  it('gives the seven diatonic pitches of each key their key-signature spelling', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      const alterations = keyAlterations(fifths);
      const naturalPc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
      for (const [step, alter] of Object.entries(alterations)) {
        const pc = ((naturalPc[step] as number) + alter + 12) % 12;
        const midi = 60 + pc; // somewhere in the octave above middle C
        const spelled = spellNote(midi, fifths);
        assert.equal(spelled.step, step, `fifths=${fifths} expected letter ${step}`);
        assert.equal(spelled.alter, alter, `fifths=${fifths} expected alter ${alter} on ${step}`);
      }
    }
  });
});

describe('vexflow output', () => {
  it('formats keys the way StaveNote expects', () => {
    assert.equal(vexflowKey(spellNote(60)), 'c/4');
    assert.equal(vexflowKey(spellNote(61)), 'c#/4');
    assert.equal(vexflowKey(spellNote(63, -3)), 'eb/4');
    assert.equal(vexflowKey(spellNote(21)), 'a/0');
  });

  it('omits an accidental the key signature already implies', () => {
    // F sharp in G major is in the key signature.
    assert.equal(vexflowAccidental(spellNote(66, 1), 1), null);
    // F natural in G major must be drawn with a natural sign.
    assert.equal(vexflowAccidental(spellNote(65, 1), 1), 'n');
    // C sharp in C major needs an explicit sharp.
    assert.equal(vexflowAccidental(spellNote(61, 0), 0), '#');
    // B flat in E flat major is in the key signature.
    assert.equal(vexflowAccidental(spellNote(70, -3), -3), null);
    // B natural in E flat major needs a natural.
    assert.equal(vexflowAccidental(spellNote(71, -3), -3), 'n');
  });
});

describe('helpers', () => {
  it('identifies black keys', () => {
    assert.equal(isBlackKey(61), true); // C#
    assert.equal(isBlackKey(60), false); // C
    assert.equal(isBlackKey(70), true); // Bb
    assert.equal(isBlackKey(71), false); // B
    // Exactly 36 of the 88 piano keys are black.
    let black = 0;
    for (let m = 21; m <= 108; m++) if (isBlackKey(m)) black++;
    assert.equal(black, 36);
  });

  it('computes equal-temperament frequencies', () => {
    assert.equal(frequencyOf(69), 440);
    assert.ok(Math.abs(frequencyOf(60) - 261.6256) < 0.001);
    assert.ok(Math.abs(frequencyOf(81) - 880) < 1e-9);
  });
});
