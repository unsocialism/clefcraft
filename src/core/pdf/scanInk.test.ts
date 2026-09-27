import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clefFromInk, readKeySignature, scanPageInk } from './scanInk.ts';
import type { Raster } from './raster.ts';
import { groupStaffLines, pitchAt, widenStaves } from './staffGeometry.ts';

/**
 * A fake scan.
 *
 * Drawn rather than photographed, and deliberately plain: five lines, a mark
 * where a clef goes, and noteheads on the positions asked for. What is being
 * checked is not whether a picture of real music comes out right — that is
 * what the real scans in the harness are for — but that the geometry holds:
 * a notehead drawn three half-spaces above the bottom line has to come back
 * as the pitch three half-spaces above the bottom line, in PDF coordinates,
 * the right way up.
 */
const SPACING = 18;
const PAGE_WIDTH = 612;

function page(width = 900, height = 600): Raster {
  return { width, height, ink: new Uint8Array(width * height) };
}

function dot(raster: Raster, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  (raster.ink as Uint8Array)[Math.round(y) * raster.width + Math.round(x)] = 1;
}

function box(raster: Raster, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dot(raster, x, y);
}

function staffLines(raster: Raster, top: number, x0: number, x1: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < 5; i++) {
    const y = top + i * SPACING;
    box(raster, x0, y, x1, y + 1);
    ys.push(y);
  }
  return ys;
}

function notehead(raster: Raster, x: number, y: number): void {
  const rx = SPACING * 0.65;
  const ry = SPACING * 0.45;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) dot(raster, x + dx, y + dy);
    }
  }
}

/** A blot standing where a clef does, reaching below the staff like a treble. */
function trebleish(raster: Raster, x: number, top: number): void {
  box(raster, x, top - SPACING, x + SPACING * 2, top + SPACING * 5.5);
}

/** And one that keeps to the top half, like a bass clef. */
function bassish(raster: Raster, x: number, top: number): void {
  box(raster, x, top - SPACING * 0.4, x + SPACING * 2, top + SPACING * 2.2);
}

describe('reading a key signature by where its marks stand', () => {
  it('reads one sharp on a treble staff', () => {
    assert.deepEqual(readKeySignature([8], 'treble'), { fifths: 1, alter: 1 });
  });

  it('reads four sharps, in the order they are always written', () => {
    assert.deepEqual(readKeySignature([8, 5, 9, 6], 'treble'), { fifths: 4, alter: 1 });
  });

  it('reads flats, which stand in quite different places', () => {
    assert.deepEqual(readKeySignature([4, 7], 'treble'), { fifths: -2, alter: -1 });
    assert.deepEqual(readKeySignature([2, 5], 'bass'), { fifths: -2, alter: -1 });
  });

  it('reads the same key a fourth lower on a bass staff', () => {
    assert.deepEqual(readKeySignature([6], 'bass'), { fifths: 1, alter: 1 });
  });

  it('forgives half a half-space of wobble and no more', () => {
    assert.deepEqual(readKeySignature([8], 'treble'), { fifths: 1, alter: 1 });
    assert.equal(readKeySignature([10], 'treble'), null, 'nothing stands there');
  });

  it('says nothing when there is nothing to read', () => {
    assert.equal(readKeySignature([], 'treble'), null);
    assert.equal(readKeySignature([8, 5, 9, 6, 3, 7, 4, 1], 'treble'), null, 'eight is not a key');
  });
});

describe('telling the clefs apart', () => {
  it('calls it treble when the ink runs below the staff', () => {
    assert.equal(clefFromInk(400, 900, SPACING), 'treble');
  });

  it('calls it bass when it keeps to the top half', () => {
    assert.equal(clefFromInk(0, 900, SPACING), 'bass');
  });

  it('says nothing when there is barely any ink at all', () => {
    assert.equal(clefFromInk(3, 5, SPACING), null);
  });
});

describe('reading a page of drawn music', () => {
  const raster = page();
  const top = 120;
  const lines = staffLines(raster, top, 60, 840);
  const lower = staffLines(raster, top + SPACING * 12, 60, 840);
  trebleish(raster, 70, top);
  bassish(raster, 70, top + SPACING * 12);
  // A barline down the whole system, so the two staves read as one system.
  box(raster, 58, top, 60, lower[4]!);
  box(raster, 838, top, 840, lower[4]!);
  // Three notes on the treble staff: bottom line, middle line, top line.
  notehead(raster, 300, lines[4]!);
  notehead(raster, 400, lines[2]!);
  notehead(raster, 500, lines[0]!);
  // And one on the bass staff's middle line.
  notehead(raster, 300, lower[2]!);

  const { ink, report } = scanPageInk(raster, {
    pageWidth: PAGE_WIDTH,
    pageHeight: (PAGE_WIDTH * raster.height) / raster.width,
  });

  it('finds both staves and all ten lines', () => {
    assert.equal(report.staves, 2);
    assert.equal(ink.rules.length, 10);
  });

  it('finds every notehead and no more', () => {
    assert.equal(report.filledHeads, 4);
    assert.equal(report.hollowHeads, 0);
  });

  it('puts the lines the right way up, with Y increasing upward', () => {
    const ys = ink.rules.map((rule) => rule.y);
    // The topmost line on the page must have the largest PDF Y.
    assert.ok(ys[0]! > ys[9]!);
    assert.ok(Math.abs(ys[0]! - ys[1]!) > 0);
  });

  it('reads back the pitches the noteheads were drawn on', () => {
    const staves = widenStaves(groupStaffLines([...ink.rules]), ink.segments);
    assert.equal(staves.length, 2);
    const treble = staves[0]!;
    const heads = ink.glyphs
      .filter((glyph) => glyph.ch === '' && glyph.y > treble.lineYs[4]! - 40)
      .sort((a, b) => a.x - b.x);
    assert.equal(heads.length, 3);
    assert.deepEqual(
      heads.map((head) => {
        const pitch = pitchAt(head.y, treble, 'treble');
        return `${pitch.step}${pitch.octave}`;
      }),
      ['E4', 'B4', 'F5'],
    );
  });

  it('marks the clef on the line it names', () => {
    const staves = widenStaves(groupStaffLines([...ink.rules]), ink.segments);
    const treble = ink.glyphs.find((glyph) => glyph.ch === '');
    assert.ok(treble, 'a treble clef was written out');
    // The treble clef is anchored on the G line, one space above the bottom.
    const bottom = staves[0]!.lineYs[4]!;
    assert.ok(Math.abs(treble.y - (bottom + staves[0]!.spacing)) < staves[0]!.spacing * 0.3);
  });

  it('gives the bass staff a bass clef', () => {
    assert.ok(ink.glyphs.some((glyph) => glyph.ch === ''));
  });

  it('finds the barlines as strokes spanning the system', () => {
    const tall = ink.strokes.filter((stroke) => stroke.y1 - stroke.y0 > SPACING * 8 * (PAGE_WIDTH / 900));
    assert.ok(tall.length >= 2, `expected the two barlines, found ${tall.length}`);
  });
});

describe('a page with no music on it', () => {
  it('comes back empty rather than guessing', () => {
    const { ink, report } = scanPageInk(page(300, 300), { pageWidth: 612, pageHeight: 612 });
    assert.equal(report.staves, 0);
    assert.equal(ink.rules.length, 0);
    assert.equal(ink.glyphs.length, 0);
  });
});
