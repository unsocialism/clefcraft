/**
 * Reading a page's ink: horizontal rules, vertical strokes and glyph
 * positions, straight from the PDF operator stream.
 *
 * Nothing here knows about music. It answers "what was drawn, and where",
 * and {@link ./pdfNotes.ts} turns that into notes.
 *
 * Why the operator stream rather than the friendlier APIs:
 *
 * - `getTextContent` merges consecutive glyphs into one item and reports a
 *   single origin for the whole string. A run of noteheads drawn in one
 *   show-text operation therefore all come back at the first notehead's
 *   coordinates, and every note after the first in such a run reads as a
 *   repeat of it. Walking the text matrix and advancing by each glyph's own
 *   width gives the position the renderer would actually draw at.
 *
 * - A path's bounding box is not its shape. Sibelius draws one staff line
 *   per path, where the box happens to be the line; MuseScore puts a whole
 *   five-line staff in one path, where the box spans all five lines at once
 *   and no staff is ever found. So the points are decoded instead.
 */

/** Minimal shape of the pdf.js module this file needs. */
export interface PdfOps {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly constructPath: number;
  readonly beginText: number;
  readonly setTextMatrix: number;
  readonly moveText: number;
  readonly setLeading: number;
  readonly nextLine: number;
  readonly setFont: number;
  readonly showText: number;
}

export interface OperatorList {
  readonly fnArray: ArrayLike<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly argsArray: ArrayLike<any>;
}

export interface PageLike {
  getOperatorList(): Promise<OperatorList>;
}

/** A horizontal rule: staff line, ledger line, or the flat edge of a beam. */
export interface Rule {
  readonly y: number;
  x0: number;
  x1: number;
}

/** A vertical stroke: part of a barline, a note stem, a bracket. */
export interface Stroke {
  readonly x: number;
  readonly y0: number;
  y1: number;
}

/** One drawn character, at the position it was drawn. */
export interface Glyph {
  readonly ch: string;
  readonly x: number;
  readonly y: number;
  /** Font size in text space — grace notes are drawn smaller. */
  readonly size: number;
  /**
   * How far the pen moved for this glyph, in the same units as `x`. The
   * position is the glyph's origin, which for a notehead is its left edge,
   * so the centre is `x + advance / 2` — which is where a marker drawn over
   * the note has to go.
   */
  readonly advance: number;
}

export interface PageInk {
  /**
   * Horizontal segments collapsed by Y, for finding staves. Only segments
   * that are already staff-line length take part, because collapsing by Y
   * alone would union two unrelated ledger lines at opposite ends of the
   * page into one page-wide "staff line" and anchor a staff on it.
   */
  readonly rules: readonly Rule[];
  /** Every horizontal segment, uncollapsed, for measuring how far a staff reaches. */
  readonly segments: readonly Rule[];
  readonly strokes: readonly Stroke[];
  readonly glyphs: readonly Glyph[];
}

type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** pdf.js hands matrices over as plain objects with numeric keys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMatrix(value: any): Matrix {
  if (Array.isArray(value) && value.length === 6) return value as unknown as Matrix;
  const nums = Object.keys(value)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => value[k] as number);
  return nums as unknown as Matrix;
}

/** Straightness thresholds, in points. */
const FLAT = 0.4;
/** Shorter than this and a "rule" is a stem cap or a dot, not a line. */
const MIN_RULE = 3;
/** A segment must be this long to be offered as a staff-line candidate. */
export const STAFF_LINE_LENGTH = 40;
/** Shorter than this and a vertical is part of a glyph, not a stroke. */
const MIN_STROKE = 8;

export async function readPageInk(page: PageLike, OPS: PdfOps): Promise<PageInk> {
  const ops = await page.getOperatorList();

  let ctm: Matrix = IDENTITY;
  const ctmStack: Matrix[] = [];

  const segments: Rule[] = [];
  const strokes: Stroke[] = [];
  const glyphs: Glyph[] = [];

  // Text state. pdf.js keeps the pen offset separate from the text matrix,
  // so the glyph origin is the text matrix applied to that offset.
  let tm: Matrix = IDENTITY;
  let penX = 0;
  let penY = 0;
  let lineX = 0;
  let lineY = 0;
  let size = 0;
  let leading = 0;
  const moveText = (tx: number, ty: number) => {
    lineX += tx;
    lineY += ty;
    penX = lineX;
    penY = lineY;
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!;
    const args = ops.argsArray[i];

    if (fn === OPS.save) ctmStack.push(ctm);
    else if (fn === OPS.restore) ctm = ctmStack.pop() ?? IDENTITY;
    else if (fn === OPS.transform) ctm = mul(ctm, toMatrix(args));
    else if (fn === OPS.beginText) {
      tm = IDENTITY;
      penX = penY = lineX = lineY = 0;
    } else if (fn === OPS.setTextMatrix) {
      tm = toMatrix(args.length === 6 ? args : args[0]);
      penX = penY = lineX = lineY = 0;
    } else if (fn === OPS.moveText) moveText(args[0], args[1]);
    else if (fn === OPS.setLeading) leading = args[0];
    else if (fn === OPS.nextLine) moveText(0, -leading);
    else if (fn === OPS.setFont) size = args[1];
    else if (fn === OPS.showText) {
      for (const g of args[0]) {
        // A bare number in the array is a kerning adjustment, not a glyph.
        if (typeof g === 'number') {
          penX -= (g * size) / 1000;
          continue;
        }
        const advanceText = g.width * size * 0.001;
        const [tx, ty] = apply(tm, penX, penY);
        const [x, y] = apply(ctm, tx, ty);
        // Measure the advance in device units too, so a scaled page does
        // not need the caller to know about the transform.
        const [ax, ay] = apply(ctm, ...apply(tm, penX + advanceText, penY));
        glyphs.push({ ch: g.unicode, x, y, size, advance: Math.hypot(ax - x, ay - y) });
        penX += advanceText;
      }
    } else if (fn === OPS.constructPath) {
      const points: { x: number; y: number }[] = [];
      for (const raw of args[1]) {
        // Each entry is (opcode, x, y) repeated.
        const nums = Object.keys(raw)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => raw[k] as number);
        for (let k = 0; k + 2 < nums.length; k += 3) {
          const [x, y] = apply(ctm, nums[k + 1]!, nums[k + 2]!);
          points.push({ x, y });
        }
      }
      for (let k = 1; k < points.length; k++) {
        const a = points[k - 1]!;
        const b = points[k]!;
        if (Math.abs(a.y - b.y) < FLAT && Math.abs(a.x - b.x) > MIN_RULE) {
          segments.push({
            y: (a.y + b.y) / 2,
            x0: Math.min(a.x, b.x),
            x1: Math.max(a.x, b.x),
          });
        } else if (Math.abs(a.x - b.x) < FLAT && Math.abs(a.y - b.y) > MIN_STROKE) {
          strokes.push({
            x: (a.x + b.x) / 2,
            y0: Math.min(a.y, b.y),
            y1: Math.max(a.y, b.y),
          });
        }
      }
    }
  }

  return { rules: collapseByY(segments), segments, strokes, glyphs };
}

/**
 * Collapse staff-line-length segments that share a Y.
 *
 * A staff line is drawn in pieces, one per measure, and the pieces do not
 * always touch. Collapsing across the whole page spans those gaps, which is
 * what makes the line findable at all.
 */
export function collapseByY(segments: readonly Rule[], tolerance = 0.3): Rule[] {
  const byY = new Map<number, Rule>();
  for (const segment of segments) {
    if (segment.x1 - segment.x0 <= STAFF_LINE_LENGTH) continue;
    const key = [...byY.keys()].find((k) => Math.abs(k - segment.y) < tolerance) ?? segment.y;
    const existing = byY.get(key);
    if (existing) {
      existing.x0 = Math.min(existing.x0, segment.x0);
      existing.x1 = Math.max(existing.x1, segment.x1);
    } else byY.set(key, { y: segment.y, x0: segment.x0, x1: segment.x1 });
  }
  return [...byY.values()];
}

/**
 * Join vertical strokes that share an X and meet end to end.
 *
 * A grand-staff barline is not one stroke: it arrives as a piece down the
 * upper staff, a piece bridging the gap and a piece down the lower one.
 *
 * Clustering by X *first* matters. Sorting everything by X and joining
 * neighbours in one pass looks equivalent and is not — two strokes can
 * share an X and sit in different systems, and joining those swallows a
 * real barline into a note stem three systems away.
 */
export function joinStrokes(strokes: readonly Stroke[], gap = 1): Stroke[] {
  const columns: { x: number; strokes: Stroke[] }[] = [];
  for (const stroke of [...strokes].sort((a, b) => a.x - b.x)) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(last.x - stroke.x) < 0.6) last.strokes.push(stroke);
    else columns.push({ x: stroke.x, strokes: [stroke] });
  }

  const joined: Stroke[] = [];
  for (const column of columns) {
    let open: Stroke | null = null;
    for (const stroke of column.strokes.sort((a, b) => a.y0 - b.y0)) {
      if (open && stroke.y0 <= open.y1 + gap) {
        open.y1 = Math.max(open.y1, stroke.y1);
      } else {
        open = { x: column.x, y0: stroke.y0, y1: stroke.y1 };
        joined.push(open);
      }
    }
  }
  return joined;
}
