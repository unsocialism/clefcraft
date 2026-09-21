import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collapseByY, joinStrokes, readPageInk, type PdfOps, type Stroke } from './glyphs.ts';

const stroke = (x: number, y0: number, y1: number): Stroke => ({ x, y0, y1 });

describe('joining vertical strokes', () => {
  it('rebuilds a barline drawn in pieces', () => {
    // A grand-staff barline arrives as upper staff, gap, lower staff.
    const [run, ...rest] = joinStrokes([
      stroke(100, 700, 720),
      stroke(100, 720, 760),
      stroke(100, 760, 780),
    ]);
    assert.equal(rest.length, 0);
    assert.equal(run!.y0, 700);
    assert.equal(run!.y1, 780);
  });

  it('keeps strokes at the same x but in different systems apart', () => {
    // This is the failure that made a real barline vanish: joined by x
    // alone, the barline below is swallowed by the stem above.
    const runs = joinStrokes([stroke(100, 700, 720), stroke(100, 400, 480)]);
    assert.equal(runs.length, 2);
    assert.deepEqual(
      runs.map((r) => [r.y0, r.y1]).sort((a, b) => a[0]! - b[0]!),
      [
        [400, 480],
        [700, 720],
      ],
    );
  });

  it('treats a small x difference as the same column', () => {
    const runs = joinStrokes([stroke(100, 700, 720), stroke(100.3, 720, 760)]);
    assert.equal(runs.length, 1);
  });

  it('keeps two nearby barlines separate', () => {
    const runs = joinStrokes([stroke(100, 700, 780), stroke(103, 700, 780)]);
    assert.equal(runs.length, 2);
  });
});

describe('collapsing horizontal rules', () => {
  it('spans the gaps a staff line is drawn with', () => {
    const rules = collapseByY([
      { y: 500, x0: 50, x1: 200 },
      { y: 500.1, x0: 260, x1: 420 },
    ]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.x0, 50);
    assert.equal(rules[0]!.x1, 420);
  });

  it('leaves short segments out, so ledger lines cannot span the page', () => {
    // Two ledger lines at the same height at opposite ends of the page
    // would otherwise collapse into one page-wide "staff line".
    const rules = collapseByY([
      { y: 500, x0: 50, x1: 62 },
      { y: 500, x0: 520, x1: 532 },
    ]);
    assert.equal(rules.length, 0);
  });

  it('keeps different heights apart', () => {
    const rules = collapseByY([
      { y: 500, x0: 50, x1: 400 },
      { y: 505, x0: 50, x1: 400 },
    ]);
    assert.equal(rules.length, 2);
  });
});

/**
 * A stand-in for pdf.js. The opcodes are arbitrary here — what is being
 * tested is the text-matrix arithmetic, which is where the real reader had
 * its worst bug: every glyph of a multi-glyph show-text operation came back
 * at the first glyph's position, so each note after the first in a run read
 * as a repeat of it.
 */
const OPS: PdfOps = {
  save: 1,
  restore: 2,
  transform: 3,
  constructPath: 4,
  beginText: 5,
  setTextMatrix: 6,
  moveText: 7,
  setLeading: 8,
  nextLine: 9,
  setFont: 10,
  showText: 11,
};

const glyph = (unicode: string, width = 1000) => ({ unicode, width });

const pageOf = (fnArray: number[], argsArray: unknown[]) => ({
  getOperatorList: async () => ({ fnArray, argsArray }),
});

describe('reading glyph positions', () => {
  it('advances by each glyph’s own width', async () => {
    const ink = await readPageInk(
      pageOf(
        [OPS.beginText, OPS.setFont, OPS.setTextMatrix, OPS.showText],
        [null, ['f1', 10], [[1, 0, 0, 1, 100, 200]], [[glyph('a'), glyph('b'), glyph('c')]]],
      ),
      OPS,
    );
    assert.deepEqual(
      ink.glyphs.map((g) => [g.ch, g.x, g.y]),
      [
        ['a', 100, 200],
        ['b', 110, 200],
        ['c', 120, 200],
      ],
    );
  });

  it('applies the current transform to glyph positions', async () => {
    const ink = await readPageInk(
      pageOf(
        [OPS.transform, OPS.beginText, OPS.setFont, OPS.setTextMatrix, OPS.showText],
        [[0.1, 0, 0, 0.1, 0, 0], null, ['f1', 10], [[1, 0, 0, 1, 1000, 2000]], [[glyph('a')]]],
      ),
      OPS,
    );
    assert.deepEqual(
      ink.glyphs.map((g) => [g.x, g.y]),
      [[100, 200]],
    );
  });

  it('treats a bare number as kerning, not a glyph', async () => {
    const ink = await readPageInk(
      pageOf(
        [OPS.beginText, OPS.setFont, OPS.setTextMatrix, OPS.showText],
        [null, ['f1', 10], [[1, 0, 0, 1, 0, 0]], [[glyph('a'), 100, glyph('b')]]],
      ),
      OPS,
    );
    assert.equal(ink.glyphs.length, 2);
    // 10 units of advance, less 100/1000 * 10 of kerning.
    assert.equal(ink.glyphs[1]!.x, 9);
  });

  it('restores the transform when the graphics state is popped', async () => {
    const ink = await readPageInk(
      pageOf(
        [
          OPS.save,
          OPS.transform,
          OPS.restore,
          OPS.beginText,
          OPS.setFont,
          OPS.setTextMatrix,
          OPS.showText,
        ],
        [null, [2, 0, 0, 2, 0, 0], null, null, ['f1', 10], [[1, 0, 0, 1, 5, 5]], [[glyph('a')]]],
      ),
      OPS,
    );
    assert.deepEqual(
      ink.glyphs.map((g) => [g.x, g.y]),
      [[5, 5]],
    );
  });
});

describe('reading paths', () => {
  const path = (points: number[]) => [null, [points]];

  it('decodes the points rather than the bounding box', async () => {
    // One path holding two separate horizontal lines: a bounding box would
    // report a single rectangle spanning both and find no lines at all.
    const ink = await readPageInk(
      pageOf(
        [OPS.constructPath],
        [path([0, 50, 100, 1, 400, 100, 0, 50, 110, 1, 400, 110])],
      ),
      OPS,
    );
    assert.deepEqual(
      ink.segments.map((s) => [s.y, s.x0, s.x1]),
      [
        [100, 50, 400],
        [110, 50, 400],
      ],
    );
  });

  it('separates verticals from horizontals', async () => {
    const ink = await readPageInk(
      pageOf([OPS.constructPath], [path([0, 200, 100, 1, 200, 160])]),
      OPS,
    );
    assert.equal(ink.segments.length, 0);
    // y0 is the lower end, y1 the upper: PDF Y increases upward.
    assert.deepEqual(
      ink.strokes.map((s) => [s.x, s.y0, s.y1]),
      [[200, 100, 160]],
    );
  });
});
