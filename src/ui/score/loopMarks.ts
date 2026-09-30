/**
 * Marking the section that is set to repeat, the way a printed score does.
 *
 * A repeat sign is not decoration: it is the notation every musician already
 * reads as "play this again", and it says exactly where the section starts
 * and stops — which a highlighted block does not, because a block's edge
 * could be anywhere in the bar. So the section gets a heavy barline with two
 * dots at each end and a faint wash in between, and the wash is the part that
 * can be ignored.
 *
 * The geometry is worked out here, apart from the drawing, because it is the
 * same on a score clefcraft engraved itself and on a scan of somebody else's
 * page — two different renderers, two coordinate systems, one set of rules —
 * and because rules about where a dot goes are worth being able to check.
 *
 * Everything is in screen coordinates: y increases downward. A caller in PDF
 * space flips before it gets here.
 */

/** A bar on the page: where it sits, and which bar it is. */
export interface BarBox {
  readonly measure: number;
  readonly left: number;
  readonly right: number;
  /** The staves it is drawn across, top line to bottom line of each. */
  readonly staves: readonly StaffBand[];
}

export interface StaffBand {
  /** The staff's top line, and its bottom line: top is the smaller number. */
  readonly top: number;
  readonly bottom: number;
}

export interface LoopMarks {
  /** Every bar of the section, to wash over. */
  readonly bars: readonly BarBox[];
  /** The bar the section opens in, and the bar it closes in. */
  readonly opensIn: BarBox | null;
  readonly closesIn: BarBox | null;
}

/**
 * The bars a section covers, and the two it begins and ends in.
 *
 * Bars are taken in the order the page has them, so a section that runs over
 * a line break — or a page turn — opens on one line and closes on another,
 * with the bars between washed and unmarked. That is what a printed score
 * does, and it is the reason the ends are picked out separately rather than
 * a box being drawn round the lot.
 */
export function loopMarks(bars: readonly BarBox[], from: number, to: number): LoopMarks {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const inside = bars.filter((bar) => bar.measure >= low && bar.measure <= high);
  return {
    bars: inside,
    opensIn: inside.find((bar) => bar.measure === low) ?? null,
    closesIn: [...inside].reverse().find((bar) => bar.measure === high) ?? null,
  };
}

/** A piece of a repeat sign, ready to be drawn in whatever the renderer uses. */
export type Shape =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'dot'; readonly x: number; readonly y: number; readonly r: number };

/** Proportions of a repeat sign, as fractions of one staff space. */
const THICK = 0.42;
const THIN = 0.14;
const BETWEEN = 0.3;
const DOT = 0.17;
/** How far the dots stand from the thin line. */
const DOT_GAP = 0.45;

/**
 * A repeat sign at `x`, across the staves given.
 *
 * `facing` says which way it points: an opening sign has its heavy line on
 * the outside and its dots to the right, a closing sign is the mirror of
 * that. The dots sit in the spaces either side of each staff's middle line —
 * one pair per staff, so a grand staff gets two pairs, as it should.
 *
 * The lines run from the top staff's top line to the bottom staff's bottom
 * line, joining the staves the way a barline does.
 */
export function repeatShapes(
  x: number,
  staves: readonly StaffBand[],
  facing: 'opens' | 'closes',
  space: number,
): Shape[] {
  if (staves.length === 0) return [];
  const top = Math.min(...staves.map((staff) => staff.top));
  const bottom = Math.max(...staves.map((staff) => staff.bottom));
  const height = bottom - top;
  const shapes: Shape[] = [];

  const thick = space * THICK;
  const thin = space * THIN;
  const between = space * BETWEEN;
  const gap = space * DOT_GAP;

  // Left to right, an opening sign is heavy line, gap, thin line, dots; a
  // closing sign is the mirror of it, and its heavy line ends on the
  // barline rather than starting there.
  let thickX: number;
  let thinX: number;
  let dotX: number;
  if (facing === 'opens') {
    thickX = x;
    thinX = x + thick + between;
    dotX = thinX + thin + gap;
  } else {
    thickX = x - thick;
    thinX = thickX - between - thin;
    dotX = thinX - gap;
  }
  shapes.push({ kind: 'rect', x: thickX, y: top, width: thick, height });
  shapes.push({ kind: 'rect', x: thinX, y: top, width: thin, height });

  for (const staff of staves) {
    const middle = (staff.top + staff.bottom) / 2;
    const half = (staff.bottom - staff.top) / 8; // half a staff space
    shapes.push({ kind: 'dot', x: dotX, y: middle - half, r: space * DOT });
    shapes.push({ kind: 'dot', x: dotX, y: middle + half, r: space * DOT });
  }
  return shapes;
}
