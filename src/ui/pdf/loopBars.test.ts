import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { barsOfPage } from './loopBars.ts';
import type { PdfPageLayout, StaffInfo } from '../../core/pdf/pdfNotes.ts';
import type { Staff } from '../../core/pdf/staffGeometry.ts';

const staffAt = (topLineY: number, spacing = 5): Staff => ({
  lineYs: [0, 1, 2, 3, 4].map((i) => topLineY - i * spacing),
  spacing,
  x0: 40,
  x1: 560,
});

const info = (over: Partial<StaffInfo> & { staff: Staff }): StaffInfo => ({
  system: 0,
  staffNumber: 1,
  clefs: [],
  key: {},
  keyFifths: 0,
  barlines: [],
  measureBase: 0,
  ...over,
});

/** Two systems of a grand staff, three bars each. */
const page: PdfPageLayout = {
  page: 1,
  staves: [],
  systems: [],
  barlines: [],
  staffInfo: [
    info({ staff: staffAt(700), system: 0, staffNumber: 1, barlines: [40, 200, 360, 520], measureBase: 0 }),
    info({ staff: staffAt(640), system: 0, staffNumber: 2, barlines: [40, 200, 360, 520], measureBase: 0 }),
    info({ staff: staffAt(500), system: 1, staffNumber: 1, barlines: [40, 200, 360, 520], measureBase: 3 }),
    info({ staff: staffAt(440), system: 1, staffNumber: 2, barlines: [40, 200, 360, 520], measureBase: 3 }),
  ],
};

describe('finding the bars on a PDF page', () => {
  const bars = barsOfPage(page);

  it('counts one bar fewer than the system has barlines', () => {
    assert.equal(bars.length, 6, 'three bars in each of two systems');
  });

  it('numbers them on from the bars before the system', () => {
    assert.deepEqual(
      bars.map((bar) => bar.measure),
      [1, 2, 3, 4, 5, 6],
    );
  });

  it('puts each bar between its own two barlines', () => {
    assert.deepEqual(
      bars.slice(0, 3).map((bar) => [bar.left, bar.right]),
      [
        [40, 200],
        [200, 360],
        [360, 520],
      ],
    );
  });

  it('reads a bar off the top staff only, not off both', () => {
    // Reading both staves of a grand staff would give every bar twice.
    const measures = bars.map((bar) => bar.measure);
    assert.equal(new Set(measures).size, measures.length);
  });

  it('carries both staves of the system with every bar', () => {
    assert.equal(bars[0]!.staves.length, 2);
    assert.equal(bars[0]!.staves[0]!.top, 700, 'the treble staff');
    assert.equal(bars[0]!.staves[1]!.top, 640, 'and the bass one');
    assert.equal(bars[0]!.spacing, 5);
  });

  it('says nothing about a system with no barlines at all', () => {
    const bare: PdfPageLayout = {
      ...page,
      staffInfo: [info({ staff: staffAt(700), barlines: [], measureBase: 0 })],
    };
    assert.deepEqual(barsOfPage(bare), []);
  });
});
