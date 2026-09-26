/**
 * Where the keyboard strip should sit, so that what matters is on screen.
 *
 * Eighty-eight keys at a size worth tapping are wider than a phone, so the
 * strip scrolls sideways and half the instrument is off the edge. A guide lit
 * up out there is no guide at all, and neither is a note you have just
 * played. This works out, from what is being asked for and what is under
 * your fingers, whether to move and where to — kept apart from the component
 * so the rules can be checked rather than eyeballed.
 */

/** Where something sits across the strip's own drawing, in pixels. */
export interface Span {
  readonly left: number;
  readonly right: number;
}

/** What the strip is showing right now. */
export interface View {
  readonly scrollLeft: number;
  /** The width of the window on to the keys, not of the keys themselves. */
  readonly width: number;
}

/** How close to the edge a key may sit before it counts as out of view. */
export const EDGE_MARGIN_PX = 24;

/** The smallest span holding both, or whichever one there is. */
export function union(a?: Span, b?: Span): Span | undefined {
  if (!a) return b;
  if (!b) return a;
  return { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) };
}

/**
 * The new scroll position, or `undefined` to leave the strip where it is.
 *
 * Leaving it alone is the common answer and the important one: a strip that
 * re-centred on every note would fidget under your hands, and a position you
 * scrolled to by hand has to survive for as long as you are playing inside
 * it. So it only moves when something needed is actually out of view.
 *
 * Normally what you are playing is what is being asked for and one window
 * holds both. When it cannot — a wrong note two octaves down — it shows what
 * the score wants rather than a midpoint holding neither.
 */
export function followScroll(
  view: View,
  guided?: Span,
  played?: Span,
  margin = EDGE_MARGIN_PX,
): number | undefined {
  const both = union(guided, played);
  if (!both) return undefined;
  const room = view.width - margin * 2;
  const target = both.right - both.left > room ? (guided ?? played ?? both) : both;
  const from = view.scrollLeft;
  if (target.left >= from + margin && target.right <= from + view.width - margin) {
    return undefined;
  }
  const centred = (target.left + target.right) / 2 - view.width / 2;
  return centred;
}

/** Which ends of the keyboard carry on past the edge of the screen. */
export type MoreAt = 'none' | 'left' | 'right' | 'both';

/**
 * Without this there is nothing at all to say the strip scrolls: it simply
 * looks like a keyboard that stops halfway up. The slack of a few pixels
 * keeps a strip scrolled to its very end from claiming there is more.
 */
export function moreBeyond(scrollLeft: number, width: number, scrollWidth: number, slack = 4): MoreAt {
  const hidden = scrollWidth - width;
  const left = scrollLeft > slack;
  const right = scrollLeft < hidden - slack;
  if (left && right) return 'both';
  if (left) return 'left';
  if (right) return 'right';
  return 'none';
}
