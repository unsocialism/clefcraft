import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loopMarks, repeatShapes, type BarBox } from './loopMarks.ts';

/** Four bars on one line, then two on the next, over a grand staff. */
const staves = [
  { top: 0, bottom: 40 },
  { top: 74, bottom: 114 },
];
const bars: BarBox[] = [1, 2, 3, 4].map((measure) => ({
  measure,
  left: (measure - 1) * 100,
  right: measure * 100,
  staves,
}));
const later: BarBox[] = [5, 6].map((measure) => ({
  measure,
  left: (measure - 5) * 100,
  right: (measure - 4) * 100,
  staves: staves.map((band) => ({ top: band.top + 200, bottom: band.bottom + 200 })),
}));
const page = [...bars, ...later];

describe('which bars a section covers', () => {
  it('takes the bars between the two numbers, both ends included', () => {
    const marks = loopMarks(page, 2, 4);
    assert.deepEqual(
      marks.bars.map((bar) => bar.measure),
      [2, 3, 4],
    );
  });

  it('points out the bar it opens in and the bar it closes in', () => {
    const marks = loopMarks(page, 2, 4);
    assert.equal(marks.opensIn?.measure, 2);
    assert.equal(marks.closesIn?.measure, 4);
  });

  it('takes the numbers the wrong way round as the same section', () => {
    assert.deepEqual(loopMarks(page, 4, 2), loopMarks(page, 2, 4));
  });

  it('opens on one line and closes on another when it runs over the break', () => {
    const marks = loopMarks(page, 3, 6);
    assert.equal(marks.opensIn?.staves[0]?.top, 0, 'opens on the first line');
    assert.equal(marks.closesIn?.staves[0]?.top, 200, 'closes on the second');
    assert.equal(marks.bars.length, 4);
  });

  it('marks one bar at both ends when the section is one bar', () => {
    const marks = loopMarks(page, 3, 3);
    assert.equal(marks.bars.length, 1);
    assert.equal(marks.opensIn?.measure, 3);
    assert.equal(marks.closesIn?.measure, 3);
  });

  it('comes back empty for bars the page does not hold', () => {
    const marks = loopMarks(page, 20, 24);
    assert.deepEqual(marks.bars, []);
    assert.equal(marks.opensIn, null);
    assert.equal(marks.closesIn, null);
  });
});

describe('drawing a repeat sign', () => {
  const space = 10;

  it('puts its two lines and a pair of dots on each staff', () => {
    const shapes = repeatShapes(100, staves, 'opens', space);
    assert.equal(shapes.filter((shape) => shape.kind === 'rect').length, 2);
    assert.equal(shapes.filter((shape) => shape.kind === 'dot').length, 4, 'two staves, two dots each');
  });

  it('runs its lines from the top staff to the bottom one', () => {
    const [thick] = repeatShapes(100, staves, 'opens', space);
    assert.equal(thick?.kind, 'rect');
    if (thick?.kind !== 'rect') return;
    assert.equal(thick.y, 0);
    assert.equal(thick.height, 114);
  });

  it('stands its heavy line on the outside, either way round', () => {
    const opening = repeatShapes(100, staves, 'opens', space);
    const closing = repeatShapes(100, staves, 'closes', space);
    const rects = (shapes: typeof opening) =>
      shapes.filter((shape) => shape.kind === 'rect') as Extract<
        (typeof opening)[number],
        { kind: 'rect' }
      >[];
    const [openThick, openThin] = rects(opening);
    const [closeThick, closeThin] = rects(closing);
    assert.ok(openThick!.width > openThin!.width, 'one line is heavier than the other');
    assert.ok(openThick!.x < openThin!.x, 'the heavy line opens the section');
    assert.ok(closeThick!.x > closeThin!.x, 'and closes it from the other side');
    assert.ok(closeThick!.x + closeThick!.width <= 100.001, 'the closing sign ends on the barline');
    assert.ok(openThick!.x >= 99.999, 'the opening sign starts on it');
  });

  it('puts the dots inside the section, not outside it', () => {
    const opening = repeatShapes(100, staves, 'opens', space);
    const closing = repeatShapes(100, staves, 'closes', space);
    const dotX = (shapes: typeof opening) =>
      shapes.find((shape) => shape.kind === 'dot')!.x;
    assert.ok(dotX(opening) > 100, 'an opening sign has its dots to the right');
    assert.ok(dotX(closing) < 100, 'a closing sign has them to the left');
  });

  it('sits the dots in the spaces either side of each middle line', () => {
    const dots = repeatShapes(100, [{ top: 0, bottom: 40 }], 'opens', space)
      .filter((shape) => shape.kind === 'dot')
      .map((shape) => shape.y);
    // A staff of four spaces has its middle line at 20; the spaces either
    // side of it are centred at 15 and 25.
    assert.deepEqual(dots, [15, 25]);
  });

  it('draws nothing at all where there is no staff', () => {
    assert.deepEqual(repeatShapes(100, [], 'opens', space), []);
  });
});
