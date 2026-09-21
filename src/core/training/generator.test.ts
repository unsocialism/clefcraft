import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { keyAlterations, STEPS } from '../music/keySignature.ts';
import {
  LEVELS,
  accidentalsToWrite,
  generateExercise,
  midiOf,
  scoreFromExercise,
  type Exercise,
} from './generator.ts';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);
const index = (step: (typeof STEPS)[number], octave: number) => octave * 7 + STEPS.indexOf(step);

function all(level: number): Exercise[] {
  return SEEDS.map((seed) => generateExercise({ level, seed }));
}

describe('generated exercises', () => {
  it('is reproducible from its seed', () => {
    assert.deepEqual(generateExercise({ level: 6, seed: 42 }), generateExercise({ level: 6, seed: 42 }));
    assert.notDeepEqual(
      generateExercise({ level: 6, seed: 42 }).notes,
      generateExercise({ level: 6, seed: 43 }).notes,
    );
  });

  it('fills every bar with the right number of beats', () => {
    for (const ex of all(4)) {
      assert.equal(ex.notes.length, 16);
      assert.equal(ex.events, 16);
      ex.notes.forEach((n, i) => {
        assert.equal(n.measure, Math.floor(i / 4) + 1);
        assert.equal(n.beat, i % 4);
        assert.equal(n.event, i);
      });
    }
  });

  for (const level of LEVELS) {
    it(`level ${level.id} keeps every note in its range and on its staff`, () => {
      for (const ex of all(level.id)) {
        for (const n of ex.notes) {
          assert.ok(level.clefs.includes(n.clef), `clef ${n.clef} not allowed at level ${level.id}`);
          const [low, high] = level.range[n.clef]!;
          const at = index(n.step, n.octave);
          assert.ok(at >= low && at <= high, `${n.step}${n.octave} outside level ${level.id}`);
          assert.equal(n.staff, n.clef === 'treble' ? 1 : 2);
        }
      }
    });
  }

  it('sounds what it writes', () => {
    for (const level of LEVELS) {
      for (const ex of all(level.id)) {
        for (const n of ex.notes) assert.equal(n.midi, midiOf(n.step, n.octave, n.alter));
      }
    }
  });

  it('level 1 is exactly C4 to G4 in C major with no accidentals', () => {
    const seen = new Set<number>();
    for (const ex of all(1)) {
      assert.equal(ex.fifths, 0);
      for (const n of ex.notes) {
        assert.equal(n.accidental, null);
        seen.add(n.midi);
      }
    }
    assert.deepEqual([...seen].sort((a, b) => a - b), [60, 62, 64, 65, 67]);
  });

  it('uses the whole range, not just the middle of it', () => {
    // A walk that never reached the edges would never test the hardest
    // notes of a level — the top and bottom lines.
    const treble = new Set(all(2).flatMap((ex) => ex.notes.map((n) => index(n.step, n.octave))));
    assert.ok(treble.has(index('E', 4)) && treble.has(index('F', 5)));
  });

  it('moves mostly by step, like a melody', () => {
    let steps = 0;
    let moves = 0;
    let bigLeaps = 0;
    for (const ex of all(2)) {
      for (let i = 1; i < ex.notes.length; i++) {
        const a = ex.notes[i - 1]!;
        const b = ex.notes[i]!;
        const gap = Math.abs(index(b.step, b.octave) - index(a.step, a.octave));
        moves++;
        if (gap <= 1) steps++;
        if (gap > 4) bigLeaps++;
      }
    }
    assert.ok(steps / moves > 0.45, `only ${((100 * steps) / moves).toFixed(0)}% steps or repeats`);
    assert.equal(bigLeaps, 0, 'no leap wider than a fifth');
  });

  it('rarely repeats a note', () => {
    let repeats = 0;
    let moves = 0;
    for (const ex of all(2)) {
      for (let i = 1; i < ex.notes.length; i++) {
        moves++;
        if (ex.notes[i]!.midi === ex.notes[i - 1]!.midi) repeats++;
      }
    }
    assert.ok(repeats / moves < 0.1);
  });

  it('with two staves, changes hands only at a barline', () => {
    for (const ex of all(4)) {
      for (let i = 1; i < ex.notes.length; i++) {
        if (ex.notes[i]!.staff !== ex.notes[i - 1]!.staff) assert.equal(ex.notes[i]!.beat, 0);
      }
    }
  });

  it('with two staves, uses both hands and never stays in one for three bars', () => {
    let usedBoth = 0;
    for (const ex of all(4)) {
      const byBar = [1, 2, 3, 4].map((m) => ex.notes.find((n) => n.measure === m)!.staff);
      if (new Set(byBar).size === 2) usedBoth++;
      for (let m = 2; m < byBar.length; m++) {
        assert.ok(!(byBar[m] === byBar[m - 1] && byBar[m] === byBar[m - 2]), byBar.join(''));
      }
    }
    assert.equal(usedBoth, SEEDS.length);
  });

  it('keeps accidentals out of levels 1 to 5 entirely', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (const ex of all(level)) {
        assert.equal(ex.fifths, 0);
        assert.ok(ex.notes.every((n) => n.accidental === null && n.alter === 0));
      }
    }
  });

  it('level 6 uses key signatures up to two sharps or flats, and some accidentals', () => {
    const keys = new Set<number>();
    let written = 0;
    for (const ex of all(6)) {
      keys.add(ex.fifths);
      assert.ok(Math.abs(ex.fifths) <= 2);
      written += ex.notes.filter((n) => n.accidental).length;
    }
    assert.deepEqual([...keys].sort(), [-1, -2, 0, 1, 2].sort());
    assert.ok(written > 0);
  });

  it('from level 6 up, notes follow the key unless they carry an accidental', () => {
    for (const ex of [6, 7, 8, 9].flatMap(all)) {
      const key = keyAlterations(ex.fifths);
      // Replay the bar-by-bar reading a pianist would do and check that it
      // lands on the pitch that sounds.
      const inBar = new Map<string, number>();
      let measure = 0;
      for (const n of ex.notes) {
        if (n.measure !== measure) {
          measure = n.measure;
          inBar.clear();
        }
        const slot = `${n.staff}:${n.step}${n.octave}`;
        const read =
          n.accidental === '#' ? 1 : n.accidental === 'b' ? -1 : n.accidental === 'n' ? 0 : (inBar.get(slot) ?? key[n.step]);
        inBar.set(slot, read);
        assert.equal(read, n.alter, `bar ${n.measure}: ${n.step}${n.octave}`);
      }
    }
  });
});

describe('interval levels', () => {
  const byEvent = (ex: Exercise) =>
    Array.from({ length: ex.events }, (_, e) => ex.notes.filter((n) => n.event === e));

  it('asks for two notes a beat, in one hand, for sixteen beats', () => {
    for (const level of [7, 8, 9]) {
      for (const ex of all(level)) {
        assert.equal(ex.events, 16);
        byEvent(ex).forEach((pair, e) => {
          assert.equal(pair.length, 2);
          assert.equal(pair[0]!.staff, pair[1]!.staff);
          assert.equal(pair[0]!.measure, Math.floor(e / 4) + 1);
          assert.equal(pair[0]!.beat, e % 4);
          assert.equal(pair[1]!.beat, e % 4);
        });
      }
    }
  });

  it('uses thirds to octaves, never seconds or sevenths, lowest note first', () => {
    const sizes = new Set<number>();
    for (const ex of [7, 8, 9].flatMap(all)) {
      for (const [low, high] of byEvent(ex)) {
        const size = index(high!.step, high!.octave) - index(low!.step, low!.octave);
        sizes.add(size);
      }
    }
    assert.deepEqual([...sizes].sort((a, b) => a - b), [2, 3, 4, 5, 7]);
  });

  it('moves the melody mostly by step: the top note in the right hand, the bottom in the left', () => {
    let steps = 0;
    let moves = 0;
    for (const ex of all(7)) {
      const pairs = byEvent(ex);
      for (let e = 1; e < pairs.length; e++) {
        const [a, b] = [pairs[e - 1]!, pairs[e]!];
        if (a[0]!.staff !== b[0]!.staff) continue;
        const pick = (p: typeof a) => (p[0]!.staff === 1 ? p[1]! : p[0]!);
        const gap = Math.abs(index(pick(b).step, pick(b).octave) - index(pick(a).step, pick(a).octave));
        moves++;
        if (gap <= 1) steps++;
        assert.ok(gap <= 4);
      }
    }
    assert.ok(steps / moves > 0.45);
  });

  it('takes at most one note of an interval out of the key, and an octave only as a pair', () => {
    let chromatic = 0;
    for (const ex of [7, 8, 9].flatMap(all)) {
      const key = keyAlterations(ex.fifths);
      for (const pair of byEvent(ex)) {
        const off = pair.filter((n) => n.alter !== key[n.step]);
        const [low, high] = pair as [(typeof pair)[number], (typeof pair)[number]];
        const octave = index(high.step, high.octave) - index(low.step, low.octave) === 7;
        if (octave) {
          assert.equal(low.alter, high.alter, 'an octave stays an octave');
          assert.equal(low.midi + 12, high.midi);
        } else {
          assert.ok(off.length <= 1);
        }
        if (off.length) chromatic++;
      }
    }
    assert.ok(chromatic > 0);
  });

  it('lets level 7 be played in any order and asks 8 and 9 for the notes together', () => {
    assert.equal(LEVELS.find((l) => l.id === 7)!.together ?? false, false);
    assert.equal(LEVELS.find((l) => l.id === 8)!.together, true);
    assert.equal(LEVELS.find((l) => l.id === 9)!.together, true);
  });

  it('keeps levels 7 and 8 to two sharps or flats and takes level 9 to four', () => {
    for (const level of [7, 8]) assert.ok(all(level).every((ex) => Math.abs(ex.fifths) <= 2));
    const keys = new Set(all(9).map((ex) => ex.fifths));
    assert.deepEqual([...keys].sort((a, b) => a - b), [-4, -3, -2, -1, 0, 1, 2, 3, 4]);
  });

  it('becomes a score with one two-note event per beat', () => {
    const ex = generateExercise({ level: 8, seed: 3 });
    const score = scoreFromExercise(ex);
    assert.equal(score.events.length, 16);
    score.events.forEach((event, i) => {
      assert.deepEqual(
        event.notes.map((n) => n.midi),
        ex.notes.filter((n) => n.event === i).map((n) => n.midi),
      );
      assert.equal(event.notes.length, 2);
    });
  });

  it('with two staves, still uses both hands and never stays in one for three bars', () => {
    for (const ex of all(7)) {
      const byBar = [1, 2, 3, 4].map((m) => ex.notes.find((n) => n.measure === m)!.staff);
      assert.equal(new Set(byBar).size, 2);
      for (let m = 2; m < byBar.length; m++) {
        assert.ok(!(byBar[m] === byBar[m - 1] && byBar[m] === byBar[m - 2]));
      }
    }
  });
});

describe('writing accidentals', () => {
  const n = (step: 'F' | 'B' | 'C', alter: -1 | 0 | 1, measure = 1, staff = 1, octave = 4) => ({
    step,
    octave,
    alter,
    measure,
    staff,
  });

  it('writes nothing for notes the key signature already covers', () => {
    // G major: F is sharp.
    assert.deepEqual(accidentalsToWrite([n('F', 1)], 1), [null]);
  });

  it('writes a natural to cancel the key signature', () => {
    assert.deepEqual(accidentalsToWrite([n('F', 0)], 1), ['n']);
  });

  it('lets an accidental last to the end of the bar and no further', () => {
    assert.deepEqual(
      accidentalsToWrite([n('C', 1, 1), n('C', 1, 1), n('C', 1, 2)], 0),
      ['#', null, '#'],
    );
  });

  it('writes a natural to cancel an earlier accidental in the same bar', () => {
    assert.deepEqual(accidentalsToWrite([n('C', 1), n('C', 0)], 0), ['#', 'n']);
  });

  it('applies an accidental to its own octave only', () => {
    assert.deepEqual(accidentalsToWrite([n('C', 1, 1, 1, 4), n('C', 1, 1, 1, 5)], 0), ['#', '#']);
  });

  it('keeps each staff separate', () => {
    assert.deepEqual(accidentalsToWrite([n('C', 1, 1, 1), n('C', 1, 1, 2)], 0), ['#', '#']);
  });

  it('writes flats', () => {
    assert.deepEqual(accidentalsToWrite([n('B', -1)], 0), ['b']);
    assert.deepEqual(accidentalsToWrite([n('B', -1)], -1), [null]);
  });
});

describe('an exercise as a practice score', () => {
  it('asks for one note per event, in order, with the hand attached', () => {
    const ex = generateExercise({ level: 4, seed: 7 });
    const score = scoreFromExercise(ex);
    assert.equal(score.events.length, ex.notes.length);
    score.events.forEach((event, i) => {
      assert.deepEqual(
        event.notes.map((x) => [x.midi, x.staff]),
        [[ex.notes[i]!.midi, ex.notes[i]!.staff]],
      );
      assert.equal(event.cursorIndex, i);
    });
    assert.equal(score.source, 'training');
    assert.equal(score.measureCount, 4);
  });
});
