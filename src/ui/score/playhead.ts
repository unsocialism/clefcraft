/**
 * Where on the page a moment of music is.
 *
 * Engraved music is not laid out in proportion to time — a bar of sixteenths
 * is not four times the width of a bar of quarters — so a line that swept
 * across the page at a constant speed would drift away from the notes it is
 * meant to be pointing at. Instead the sweep is pinned to the noteheads: each
 * bar records where its notes were actually drawn, and the line is
 * interpolated between them. It therefore arrives at every note exactly when
 * the note is due, and glides in between.
 *
 * The positions come from the engraver, so they are in the drawing's own
 * units; scaling to the width on screen is the SVG's job, not this one's.
 */

export interface Anchor {
  /** Quarter notes from the start of the piece. */
  readonly quarters: number;
  readonly x: number;
}

export interface MappedBar {
  /** The bar number as printed, for marking a section by its numbers. */
  readonly measure: number;
  readonly startQuarters: number;
  readonly endQuarters: number;
  /** The bar's own edges on the page, for drawing something behind it. */
  readonly leftX: number;
  readonly rightX: number;
  /** Top of the treble staff and bottom of the bass staff on this line. */
  readonly top: number;
  readonly bottom: number;
  /** Sorted by time, first note to closing barline. */
  readonly anchors: readonly Anchor[];
}

export type TimeMap = readonly MappedBar[];

export interface PlayheadSpot {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

/** The bar holding this moment, or the nearest one at either end. */
function barAt(map: TimeMap, quarters: number): MappedBar | null {
  if (map.length === 0) return null;
  let low = 0;
  let high = map.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (map[middle]!.startQuarters <= quarters) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return map[found]!;
}

export function playheadAt(map: TimeMap, quarters: number): PlayheadSpot | null {
  const bar = barAt(map, quarters);
  if (!bar || bar.anchors.length === 0) return null;
  const at = Math.min(Math.max(quarters, bar.startQuarters), bar.endQuarters);
  const anchors = bar.anchors;
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  const place = (x: number): PlayheadSpot => ({ x, top: bar.top, bottom: bar.bottom });

  if (at <= first.quarters) return place(first.x);
  if (at >= last.quarters) return place(last.x);
  for (let i = 1; i < anchors.length; i++) {
    const before = anchors[i - 1]!;
    const after = anchors[i]!;
    if (at > after.quarters) continue;
    const span = after.quarters - before.quarters;
    if (span <= 0) return place(after.x);
    const through = (at - before.quarters) / span;
    return place(before.x + (after.x - before.x) * through);
  }
  return place(last.x);
}

/**
 * How far the sweep is pulled from where the notes are towards where the
 * clock is.
 *
 * Engraved spacing is not proportional to time: between two eighth notes an
 * engraver may leave 26 units or 54, depending on what is above, below and
 * beside them. A line pinned strictly to the noteheads therefore doubles and
 * halves its speed within a bar, which reads as lurching — the thing a
 * moving line is meant to cure. Pulling halfway towards even time keeps the
 * line within a few units of each note while more than halving the change in
 * speed, and it never stops or backs up.
 */
const PULL_TO_EVEN_TIME = 0.5;

/**
 * Gather a bar's anchors: one per moment something is drawn, plus where the
 * bar hands over to the next, with duplicates at the same moment resolved to
 * the leftmost — the two hands are formatted together, so a chord in both is
 * one point in time at one place on the page.
 *
 * `end` is where the line should be when the bar's time runs out. Giving it
 * the *next* bar's first note rather than this bar's closing barline is what
 * makes the sweep continuous: without it the line reaches the barline and
 * then jumps the gap to the first note of the next bar, exactly on the beat,
 * which looks like the music skipped.
 */
export function anchorsFrom(
  points: readonly Anchor[],
  end: { quarters: number; x: number },
  pull: number = PULL_TO_EVEN_TIME,
): Anchor[] {
  const leftmost = new Map<number, number>();
  for (const point of points) {
    if (!Number.isFinite(point.quarters) || !Number.isFinite(point.x)) continue;
    if (point.quarters >= end.quarters) continue;
    const existing = leftmost.get(point.quarters);
    leftmost.set(point.quarters, existing === undefined ? point.x : Math.min(existing, point.x));
  }
  const anchors = [...leftmost].map(([quarters, x]) => ({ quarters, x }));
  anchors.push({ quarters: end.quarters, x: end.x });
  anchors.sort((a, b) => a.quarters - b.quarters);

  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last || pull <= 0 || last.quarters <= first.quarters) return anchors;
  // Blend each anchor with where even time would have put it. The two ends
  // are fixed points of that blend, so the bars still join up exactly.
  const perQuarter = (last.x - first.x) / (last.quarters - first.quarters);
  return anchors.map((anchor) => ({
    quarters: anchor.quarters,
    x:
      anchor.x * (1 - pull) +
      (first.x + (anchor.quarters - first.quarters) * perQuarter) * pull,
  }));
}
