import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  bottomLineIndex,
  clefAt,
  diatonicIndex,
  fromDiatonicIndex,
  groupStaffLines,
  pairIntoSystems,
  pitchAt,
  positionError,
  stepsAboveBottomLine,
  toMidi,
  widenStaves,
  type Staff,
} from './staffGeometry.ts';

/** Build a staff from its bottom line upward, the way engraving describes it. */
const staffAt = (bottomLineY: number, spacing = 4.6): Staff => ({
  lineYs: [4, 3, 2, 1, 0].map((i) => bottomLineY + i * spacing),
  spacing,
  x0: 50,
  x1: 550,
});

/** Rules as the extractor produces them, in PDF Y (larger is higher). */
const rules = (ys: readonly number[]) => ys.map((y) => ({ y, x0: 50, x1: 550 }));

describe('diatonic indexing', () => {
  it('counts scale degrees, not semitones', () => {
    assert.equal(diatonicIndex('C', 4), 28);
    assert.equal(diatonicIndex('D', 4), 29);
    // E to F is a semitone but still one step.
    assert.equal(diatonicIndex('F', 4) - diatonicIndex('E', 4), 1);
    assert.equal(diatonicIndex('C', 5) - diatonicIndex('B', 4), 1);
  });

  it('round-trips', () => {
    for (let i = 0; i < 70; i++) {
      const { step, octave } = fromDiatonicIndex(i);
      assert.equal(diatonicIndex(step, octave), i);
    }
  });

  it('places the clefs where engraving does', () => {
    assert.equal(bottomLineIndex('treble'), diatonicIndex('E', 4));
    assert.equal(bottomLineIndex('bass'), diatonicIndex('G', 2));
  });
});

describe('reading pitch off a staff', () => {
  const treble = staffAt(100);
  const bass = staffAt(40);
  const name = (p: { step: string; octave: number }) => `${p.step}${p.octave}`;

  it('reads the five treble lines as E4 G4 B4 D5 F5', () => {
    const lines = [0, 1, 2, 3, 4].map((i) => pitchAt(100 + i * 4.6, treble, 'treble'));
    assert.deepEqual(
      lines.map((p) => `${p.step}${p.octave}`),
      ['E4', 'G4', 'B4', 'D5', 'F5'],
    );
  });

  it('reads the four treble spaces as F4 A4 C5 E5', () => {
    const spaces = [0, 1, 2, 3].map((i) => pitchAt(100 + 2.3 + i * 4.6, treble, 'treble'));
    assert.deepEqual(
      spaces.map((p) => `${p.step}${p.octave}`),
      ['F4', 'A4', 'C5', 'E5'],
    );
  });

  it('reads the five bass lines as G2 B2 D3 F3 A3', () => {
    const lines = [0, 1, 2, 3, 4].map((i) => pitchAt(40 + i * 4.6, bass, 'bass'));
    assert.deepEqual(
      lines.map((p) => `${p.step}${p.octave}`),
      ['G2', 'B2', 'D3', 'F3', 'A3'],
    );
  });

  it('puts middle C one ledger line below the treble staff', () => {
    const p = pitchAt(100 - 4.6, treble, 'treble');
    assert.deepEqual([p.step, p.octave], ['C', 4]);
  });

  it('puts middle C one ledger line above the bass staff', () => {
    const p = pitchAt(40 + 4 * 4.6 + 4.6, bass, 'bass');
    assert.deepEqual([p.step, p.octave], ['C', 4]);
    // And the two must agree — the same sounding note from either staff.
    assert.equal(toMidi(p), 60);
  });

  it('reads the first ledger line above and below each staff', () => {
    // A ledger line sits a full space beyond the staff, so two half-steps.
    // Treble top line is F5, so one ledger line above is A5.
    assert.equal(name(pitchAt(100 + 4 * 4.6 + 4.6, treble, 'treble')), 'A5');
    // Treble bottom line is E4, so one ledger line below is C4 — middle C.
    assert.equal(name(pitchAt(100 - 4.6, treble, 'treble')), 'C4');
    // Bass top line is A3, so one above is C4 — the same middle C.
    assert.equal(name(pitchAt(40 + 4 * 4.6 + 4.6, bass, 'bass')), 'C4');
    // Bass bottom line is G2, so one below is E2.
    assert.equal(name(pitchAt(40 - 4.6, bass, 'bass')), 'E2');
  });

  it('reads notes far into ledger lines', () => {
    // Ten spaces above the treble bottom line (E4) is twenty scale degrees:
    // E4 -> E5 (7) -> E6 (14) -> D7 (20).
    assert.equal(name(pitchAt(100 + 10 * 4.6, treble, 'treble')), 'D7');
    // Five spaces below the bass bottom line (G2) is ten degrees down:
    // G2 -> G1 (7) -> D1 (10).
    assert.equal(name(pitchAt(40 - 5 * 4.6, bass, 'bass')), 'D1');
  });

  it('stays consistent across an octave anywhere on the staff', () => {
    // Seven scale degrees is always exactly one octave, wherever it starts.
    for (let steps = -12; steps <= 12; steps++) {
      const low = pitchAt(100 + steps * 2.3, treble, 'treble');
      const high = pitchAt(100 + (steps + 7) * 2.3, treble, 'treble');
      assert.equal(high.step, low.step, `step ${steps}`);
      assert.equal(high.octave, low.octave + 1, `step ${steps}`);
      assert.equal(toMidi(high) - toMidi(low), 12, `step ${steps}`);
    }
  });

  it('snaps a slightly-off position to the nearest staff place', () => {
    assert.equal(stepsAboveBottomLine(100 + 0.3, staffAt(100)), 0);
    assert.equal(stepsAboveBottomLine(100 + 2.3 - 0.2, staffAt(100)), 1);
  });

  it('reports how far off a position was, so bad reads can be flagged', () => {
    assert.ok(positionError(100, staffAt(100)) < 0.01);
    assert.ok(positionError(100 + 0.2, staffAt(100)) < 0.1);
    // Exactly between two positions: not a real note place.
    assert.ok(positionError(100 + 1.15, staffAt(100)) > 0.45);
  });
});

describe('MIDI conversion', () => {
  it('matches the anchors', () => {
    assert.equal(toMidi({ step: 'C', alter: 0, octave: 4 }), 60);
    assert.equal(toMidi({ step: 'A', alter: 0, octave: 4 }), 69);
    assert.equal(toMidi({ step: 'A', alter: 0, octave: 0 }), 21);
    assert.equal(toMidi({ step: 'C', alter: 0, octave: 8 }), 108);
  });

  it('applies accidentals', () => {
    assert.equal(toMidi({ step: 'F', alter: 1, octave: 4 }), 66);
    assert.equal(toMidi({ step: 'B', alter: -1, octave: 4 }), 70);
    // Enharmonic pairs must land on the same key.
    assert.equal(
      toMidi({ step: 'C', alter: 1, octave: 4 }),
      toMidi({ step: 'D', alter: -1, octave: 4 }),
    );
  });
});

describe('grouping rules into staves', () => {
  it('finds two staves in ten evenly spaced rules with a wide gap', () => {
    const ys = [
      705.7, 701.1, 696.5, 691.9, 687.3, // staff 1
      661.9, 657.3, 652.7, 648.1, 643.5, // staff 2
    ];
    const staves = groupStaffLines(rules(ys));
    assert.equal(staves.length, 2);
    assert.ok(Math.abs(staves[0]!.spacing - 4.6) < 0.01);
    assert.ok(Math.abs(staves[1]!.spacing - 4.6) < 0.01);
    assert.equal(staves[0]!.lineYs[0], 705.7, 'top line first');
    assert.equal(staves[0]!.lineYs[4], 687.3);
  });

  it('handles the real page-1 layout of the test score', () => {
    // 14 staves, 4.6pt spacing, ~25pt inside a system and ~33pt between.
    const ys: number[] = [];
    let y = 705.7;
    for (let s = 0; s < 14; s++) {
      for (let l = 0; l < 5; l++) ys.push(+(y - l * 4.6).toFixed(2));
      y -= 4 * 4.6 + (s % 2 === 0 ? 25.33 : 32.96);
    }
    const staves = groupStaffLines(rules(ys));
    assert.equal(staves.length, 14);
    for (const staff of staves) assert.ok(Math.abs(staff.spacing - 4.6) < 0.02);
  });

  it('rejects a group that is not five lines rather than guessing', () => {
    // Four lines then a gap: a four-line "staff" would shift every pitch.
    const staves = groupStaffLines(rules([100, 95.4, 90.8, 86.2, 40, 35.4, 30.8, 26.2, 21.6]));
    assert.equal(staves.length, 1, 'only the genuine five-line staff is kept');
    assert.equal(staves[0]!.lineYs.length, 5);
  });

  it('copes with rules arriving in any order', () => {
    const ys = [687.3, 705.7, 696.5, 701.1, 691.9];
    const staves = groupStaffLines(rules(ys));
    assert.equal(staves.length, 1);
    assert.equal(staves[0]!.lineYs[0], 705.7);
  });

  it('steps over a flat beam lying between two staff lines', () => {
    // MuseScore draws a flat beam as a long rule, here between lines 2 and 3.
    const input = [...rules([640.78, 635.78, 630.78, 625.78, 620.78]), { y: 633.28, x0: 388, x1: 570 }];
    const staves = groupStaffLines(input);
    assert.equal(staves.length, 1);
    assert.deepEqual(staves[0]!.lineYs, [640.78, 635.78, 630.78, 625.78, 620.78]);
  });

  it('finds the staves on a page crowded with beam rules', () => {
    // Beams drawn as bundles of short rules a point or two apart outnumber
    // the gaps between staff lines, so the commonest gap is a beam's.
    const input = [
      ...rules([748.65, 743.65, 738.65, 733.65, 728.65]),
      ...[685.9, 683.4, 682.15].map((y) => ({ y, x0: 77, x1: 567 })),
      ...rules([679.65, 674.65, 669.65, 664.65, 659.65]),
      ...[537.66, 535.16, 533.91, 531.41, 507.66, 505.16, 503.91, 501.41].map((y) => ({ y, x0: 113, x1: 179 })),
      ...rules([601.66, 596.66, 591.66, 586.66, 581.66]),
      ...rules([532.66, 527.66, 522.66, 517.66, 512.66]),
    ];
    const staves = groupStaffLines(input);
    assert.deepEqual(
      staves.map((s) => s.lineYs[0]),
      [748.65, 679.65, 601.66, 532.66],
    );
  });

  it('does not take a beam one space above a staff for its top line', () => {
    // Six evenly spaced rules; the top one is a short beam, not a staff line.
    const input = [{ y: 96.69, x0: 126, x1: 190 }, ...rules([91.69, 86.69, 81.69, 76.69, 71.69])];
    const staves = groupStaffLines(input);
    assert.equal(staves.length, 1);
    assert.equal(staves[0]!.lineYs[0], 91.69);
  });

  it('returns nothing for no rules', () => {
    assert.deepEqual(groupStaffLines([]), []);
  });
});

describe('pairing staves into systems', () => {
  const build = (gaps: readonly number[]) => {
    const staves: Staff[] = [];
    let bottom = 700;
    staves.push(staffAt(bottom));
    for (const gap of gaps) {
      bottom = bottom - gap - 4 * 4.6;
      staves.push(staffAt(bottom));
    }
    return staves;
  };

  it('pairs a grand staff by the smaller inner gap', () => {
    // inner 25, outer 33, inner 25
    const systems = pairIntoSystems(build([25, 33, 25]));
    assert.equal(systems.length, 2);
    assert.equal(systems[0]!.staves.length, 2);
    assert.equal(systems[1]!.staves.length, 2);
  });

  it('handles seven grand-staff systems', () => {
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) gaps.push(25.33, 32.96);
    gaps.push(25.33);
    const systems = pairIntoSystems(build(gaps));
    assert.equal(systems.length, 7);
    for (const system of systems) assert.equal(system.staves.length, 2);
  });

  it('leaves evenly spaced staves unpaired', () => {
    // Single-staff music: every gap the same, so there is nothing to pair.
    const systems = pairIntoSystems(build([30, 30, 30]));
    assert.equal(systems.length, 4);
    for (const system of systems) assert.equal(system.staves.length, 1);
  });

  it('handles a single staff', () => {
    assert.equal(pairIntoSystems(build([])).length, 1);
  });

  it('handles no staves', () => {
    assert.deepEqual(pairIntoSystems([]), []);
  });
});

describe('grouping survives rules that are not staff lines', () => {
  /** Five lines of a staff, top-first, at the given bottom line. */
  const staffRules = (bottomY: number, spacing = 4.61) =>
    [4, 3, 2, 1, 0].map((i) => ({ y: +(bottomY + i * spacing).toFixed(2), x0: 46, x1: 559 }));

  it('ignores a stray long rule between staves', () => {
    // Exactly the shape found on page 2 of the test score: an 8va bracket or
    // similar dash sitting on its own between two staves. Absorbed into a
    // group, it shifts every staff below it and moves all their pitches.
    const input = [
      ...staffRules(600),
      { y: 464.73, x0: 100, x1: 300 }, // the stray
      ...staffRules(421.83),
      ...staffRules(380),
    ];
    const staves = groupStaffLines(input);
    assert.equal(staves.length, 3, 'the stray must not consume a staff');
    assert.ok(Math.abs(staves[1]!.lineYs[4]! - 421.83) < 0.01, 'the staff below survives intact');
  });

  it('ignores several strays', () => {
    const input = [
      { y: 720, x0: 100, x1: 400 },
      ...staffRules(600),
      { y: 540, x0: 100, x1: 400 },
      { y: 500, x0: 100, x1: 400 },
      ...staffRules(421.83),
    ];
    assert.equal(groupStaffLines(input).length, 2);
  });

  it('produces an even staff count for a two-page grand-staff score', () => {
    // 14 staves per page is what the real file has; an odd count means a
    // staff was lost and every system pairing after it is wrong.
    const build = (count: number) => {
      const out: { y: number; x0: number; x1: number }[] = [];
      let bottom = 700;
      for (let s = 0; s < count; s++) {
        out.push(...staffRules(bottom));
        bottom -= 4 * 4.61 + (s % 2 === 0 ? 25.3 : 33);
      }
      return out;
    };
    assert.equal(groupStaffLines(build(14)).length, 14);
    assert.equal(groupStaffLines([...build(14), { y: 464.73, x0: 100, x1: 300 }]).length, 14);
  });

  it('is not fooled by a stray that happens to sit one spacing away', () => {
    // A sixth evenly spaced rule would make a six-line "staff". The scan
    // takes the first five and re-tests from the sixth, which then fails.
    const input = [...staffRules(600), { y: +(600 - 4.61).toFixed(2), x0: 46, x1: 559 }];
    const staves = groupStaffLines(input);
    assert.equal(staves.length, 1);
    assert.equal(staves[0]!.lineYs.length, 5);
  });
});

describe('clef changes along a staff', () => {
  const runs = [
    { x: 50, clef: 'bass' as const },
    { x: 300, clef: 'treble' as const },
    { x: 480, clef: 'bass' as const },
  ];

  it('uses the clef in force at that point', () => {
    assert.equal(clefAt(runs, 60), 'bass');
    assert.equal(clefAt(runs, 299), 'bass');
    assert.equal(clefAt(runs, 300), 'treble', 'a clef applies from where it is drawn');
    assert.equal(clefAt(runs, 400), 'treble');
    assert.equal(clefAt(runs, 500), 'bass');
  });

  it('falls back to the first clef for anything to its left', () => {
    // Notation drawn slightly left of the clef glyph's origin still belongs
    // to that clef; there is nothing earlier it could belong to.
    assert.equal(clefAt(runs, 10), 'bass');
  });

  it('does not care what order the changes arrive in', () => {
    const shuffled = [runs[2]!, runs[0]!, runs[1]!];
    assert.equal(clefAt(shuffled, 400), 'treble');
    assert.equal(clefAt(shuffled, 500), 'bass');
  });

  it('handles a staff with one clef', () => {
    assert.equal(clefAt([{ x: 50, clef: 'treble' }], 999), 'treble');
  });

  it('reports nothing when no clef was found', () => {
    assert.equal(clefAt([], 100), null);
  });

  it('changes the pitch it reads by twelve scale degrees', () => {
    // The cost of getting this wrong: the same position on the page is A3
    // under a bass clef and C5 under a treble one.
    const staff = staffAt(100);
    const y = 100 + 4 * 4.6; // top line
    assert.equal(`${pitchAt(y, staff, 'bass').step}${pitchAt(y, staff, 'bass').octave}`, 'A3');
    assert.equal(`${pitchAt(y, staff, 'treble').step}${pitchAt(y, staff, 'treble').octave}`, 'F5');
  });
});

describe('widening a staff with its shorter pieces', () => {
  const spacing = 5;
  const staff = staffAt(100, spacing); // lines at 100,105,110,115,120
  const at = (y: number, x0: number, x1: number) => ({ y, x0, x1 });

  it('extends to a piece that continues the line', () => {
    // The long part was found; the final measure's short tail was not.
    const [widened] = widenStaves([{ ...staff, x0: 50, x1: 500 }], [at(100, 500, 535)]);
    assert.equal(widened!.x1, 535);
    assert.equal(widened!.x0, 50);
  });

  it('chains through pieces that only touch end to end', () => {
    const [widened] = widenStaves(
      [{ ...staff, x0: 50, x1: 500 }],
      [at(120, 530, 560), at(105, 500, 531)],
    );
    assert.equal(widened!.x1, 560);
  });

  it('ignores a ledger line, which is off the five lines by definition', () => {
    const [widened] = widenStaves([{ ...staff, x0: 50, x1: 500 }], [at(125, 501, 512)]);
    assert.equal(widened!.x1, 500);
  });

  it('ignores a piece that does not reach the staff', () => {
    const [widened] = widenStaves([{ ...staff, x0: 50, x1: 500 }], [at(110, 540, 570)]);
    assert.equal(widened!.x1, 500);
  });

  it('leaves a staff alone when nothing continues it', () => {
    const [widened] = widenStaves([staff], []);
    assert.deepEqual(widened, staff);
  });
});
