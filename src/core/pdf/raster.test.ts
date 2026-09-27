import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  blobs,
  columnGroups,
  deskew,
  deskewProfile,
  estimateSlope,
  findLineBands,
  groupRasterStaves,
  holes,
  longestRun,
  openRect,
  rasterFromPixels,
  removeStaffLines,
  removeVerticalRuns,
  slopeAt,
  slopeProfile,
  stripLineRows,
  verticalRuns,
  type Raster,
} from './raster.ts';

/** A blank page to draw a fake scan on. */
function blank(width: number, height: number): Raster & { ink: Uint8Array } {
  return { width, height, ink: new Uint8Array(width * height) };
}

function dot(raster: Raster, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  (raster.ink as Uint8Array)[Math.round(y) * raster.width + Math.round(x)] = 1;
}

function line(raster: Raster, y: number, x0: number, x1: number, thickness = 2): void {
  for (let t = 0; t < thickness; t++) for (let x = x0; x <= x1; x++) dot(raster, x, y + t);
}

function bar(raster: Raster, x: number, y0: number, y1: number, thickness = 3): void {
  for (let t = 0; t < thickness; t++) for (let y = y0; y <= y1; y++) dot(raster, x + t, y);
}

/** A filled notehead: an ellipse about 1.3 spaces by 0.9. */
function notehead(raster: Raster, x: number, y: number, spacing: number, filled = true): void {
  const rx = spacing * 0.65;
  const ry = spacing * 0.45;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const inside = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (inside > 1) continue;
      if (!filled && inside < 0.42) continue;
      dot(raster, x + dx, y + dy);
    }
  }
}

/** Five lines, with the top one at `top`. */
function staff(raster: Raster, top: number, spacing: number, x0: number, x1: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < 5; i++) {
    const y = top + i * spacing;
    line(raster, y, x0, x1);
    ys.push(y);
  }
  return ys;
}

describe('turning pixels into ink', () => {
  it('counts anything dark as ink and anything pale as paper', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const raster = rasterFromPixels(pixels, 2, 1);
    assert.deepEqual([...raster.ink], [1, 0]);
  });

  it('treats a transparent pixel as paper', () => {
    // A PDF page rendered with no background leaves its margins transparent,
    // and black-on-nothing would make the whole page one blob.
    const pixels = new Uint8ClampedArray([0, 0, 0, 0]);
    assert.deepEqual([...rasterFromPixels(pixels, 1, 1).ink], [0]);
  });
});

describe('measuring the tilt of a page', () => {
  it('finds a level page level', () => {
    const page = blank(400, 200);
    staff(page, 60, 16, 20, 380);
    assert.ok(Math.abs(estimateSlope(page)) < 0.002);
  });

  it('measures a tilt and takes it out', () => {
    const tilted = blank(400, 220);
    // Draw the staff already sloping, a pixel down every hundred across.
    for (let i = 0; i < 5; i++) {
      for (let x = 20; x < 380; x++) {
        dot(tilted, x, 60 + i * 16 + Math.round(x * 0.01));
        dot(tilted, x, 61 + i * 16 + Math.round(x * 0.01));
      }
    }
    const slope = estimateSlope(tilted);
    assert.ok(slope < -0.008 && slope > -0.012, `slope was ${slope}`);
    const straightened = deskew(tilted, slope);
    assert.equal(findLineBands(straightened).length, 5);
  });

  it('measures the tilt in bands, for a page that is not flat', () => {
    const page = blank(400, 400);
    staff(page, 40, 16, 20, 380);
    staff(page, 260, 16, 20, 380);
    const profile = slopeProfile(page, 4);
    assert.equal(profile.length, 4);
    assert.equal(findLineBands(deskewProfile(page, profile)).length, 10);
  });

  it('slides between the bands rather than stepping', () => {
    const middle = slopeAt([0, 0.02], 50, 100);
    assert.ok(middle > 0 && middle < 0.02, `middle was ${middle}`);
    assert.equal(slopeAt([0.01], 10, 100), 0.01);
    assert.equal(slopeAt([], 10, 100), 0);
  });
});

describe('finding staff lines', () => {
  it('measures how far a row runs, over small gaps', () => {
    const page = blank(100, 3);
    for (let x = 10; x <= 40; x++) dot(page, x, 1);
    for (let x = 44; x <= 70; x++) dot(page, x, 1);
    assert.equal(longestRun(page, 1, 5).length, 60);
    // With no gap allowed it stops at the break.
    assert.equal(longestRun(page, 1, 1).length, 30);
  });

  it('finds five bands for a staff and none for a dense bar of notes', () => {
    const page = blank(400, 200);
    staff(page, 50, 16, 20, 380);
    // A thicket of noteheads carries plenty of ink but runs nowhere.
    for (let x = 100; x < 200; x += 8) notehead(page, x, 120, 16);
    const bands = findLineBands(page);
    assert.equal(bands.length, 5);
    // Each line is drawn two rows thick, so its middle is half a row below
    // where it starts.
    assert.deepEqual(
      bands.map((band) => Math.round(band.y)),
      [51, 67, 83, 99, 115],
    );
  });

  it('gathers bands into staves and measures the spacing', () => {
    const page = blank(400, 400);
    staff(page, 40, 16, 20, 380);
    staff(page, 200, 16, 20, 380);
    const staves = groupRasterStaves(findLineBands(page));
    assert.equal(staves.length, 2);
    assert.ok(Math.abs(staves[0]!.spacing - 16) < 0.6);
    assert.equal(staves[0]!.lines.length, 5);
  });

  it('drops a run of lines that is not five, rather than guessing', () => {
    const page = blank(400, 300);
    for (let i = 0; i < 4; i++) line(page, 40 + i * 16, 20, 380);
    staff(page, 180, 16, 20, 380);
    const staves = groupRasterStaves(findLineBands(page));
    assert.equal(staves.length, 1, 'only the five-line staff is a staff');
    assert.ok(Math.abs(staves[0]!.lines[0]!.y - 180) < 1.5);
  });
});

describe('taking the staff lines away', () => {
  const page = blank(300, 160);
  const ys = staff(page, 40, 16, 10, 290);
  notehead(page, 120, ys[2]!, 16);
  bar(page, 200, ys[0]!, ys[4]!);
  const bands = findLineBands(page);
  const cleaned = removeStaffLines(page, bands);

  it('erases the line where nothing crosses it', () => {
    assert.equal(cleaned.ink[Math.round(ys[0]!) * 300 + 50], 0);
  });

  it('keeps the notehead sitting on a line', () => {
    assert.equal(cleaned.ink[Math.round(ys[2]!) * 300 + 120], 1);
  });

  it('keeps a barline whole where it crosses', () => {
    for (const y of ys) assert.equal(cleaned.ink[Math.round(y) * 300 + 201], 1);
  });

  it('cuts the rows out altogether when asked to', () => {
    const bare = stripLineRows(page, bands);
    for (const y of ys) assert.equal(bare.ink[Math.round(y) * 300 + 201], 0);
    // The notehead survives between the lines, which is all that is wanted.
    assert.equal(bare.ink[(Math.round(ys[2]!) + 5) * 300 + 120], 1);
  });
});

describe('keeping only shapes of a certain size', () => {
  it('keeps a notehead and wipes out a line, a stem and a beam', () => {
    const page = blank(300, 160);
    notehead(page, 60, 80, 16);
    line(page, 120, 10, 290, 2); // a slur or a ledger line
    bar(page, 200, 40, 120, 3); // a stem
    for (let t = 0; t < 7; t++) line(page, 30 + t, 100, 180, 1); // a beam
    const opened = openRect(page, 16 * 0.85, 16 * 0.62);
    const found = blobs(opened, 20);
    assert.equal(found.length, 1);
    assert.ok(Math.abs(found[0]!.centerX - 60) < 2);
    assert.ok(Math.abs(found[0]!.centerY - 80) < 2);
  });
});

describe('blobs and holes', () => {
  it('finds each island of ink once, with its box', () => {
    const page = blank(100, 100);
    notehead(page, 30, 30, 16);
    notehead(page, 70, 70, 16);
    const found = blobs(page, 10).sort((a, b) => a.centerX - b.centerX);
    assert.equal(found.length, 2);
    assert.ok(Math.abs(found[0]!.centerX - 30) < 1.5);
    assert.ok(found[0]!.area > 100);
  });

  it('finds the paper inside a hollow notehead and not the paper around it', () => {
    const page = blank(100, 100);
    notehead(page, 50, 50, 16, false);
    const inside = holes(page, 5);
    assert.equal(inside.length, 1);
    assert.ok(Math.abs(inside[0]!.centerX - 50) < 1.5);
    assert.ok(Math.abs(inside[0]!.centerY - 50) < 1.5);
  });
});

describe('vertical strokes', () => {
  it('finds a stem and ignores a horizontal rule', () => {
    const page = blank(200, 200);
    bar(page, 100, 40, 160, 3);
    line(page, 20, 10, 190, 2);
    const runs = verticalRuns(page, 30, 5);
    assert.equal(runs.length, 1);
    assert.ok(Math.abs(runs[0]!.x - 101) < 2);
    assert.equal(runs[0]!.y0, 40);
    assert.equal(runs[0]!.y1, 160);
  });

  it('rubs a stem out and leaves the notehead it was attached to', () => {
    const page = blank(200, 200);
    notehead(page, 100, 140, 16);
    bar(page, 106, 60, 140, 3);
    const cleaned = removeVerticalRuns(page, verticalRuns(page, 30, 5), 5);
    assert.equal(cleaned.ink[80 * 200 + 107], 0, 'the stem is gone');
    assert.equal(cleaned.ink[140 * 200 + 100], 1, 'the notehead is not');
  });
});

describe('slicing a staff into columns', () => {
  it('separates things that stand side by side', () => {
    const page = blank(300, 120);
    bar(page, 20, 20, 100, 3); // a barline
    notehead(page, 80, 60, 16);
    notehead(page, 200, 60, 16);
    const groups = columnGroups(page, 0, 299, 0, 119, 4);
    assert.equal(groups.length, 3);
    assert.ok(groups[1]!.x0 > 70 && groups[1]!.x1 < 92);
    assert.ok(groups[2]!.x0 > 190);
  });

  it('joins what sits within the gap it is given', () => {
    const page = blank(300, 120);
    notehead(page, 80, 60, 16);
    notehead(page, 92, 60, 16);
    assert.equal(columnGroups(page, 0, 299, 0, 119, 8).length, 1);
  });
});
