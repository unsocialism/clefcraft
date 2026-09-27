/**
 * Reading music off a picture of a page.
 *
 * The other half of the PDF reader takes a page apart by asking pdf.js what
 * it drew: rules for staff lines, glyphs for noteheads, each with an exact
 * position. A scan has none of that. It is one photograph of a page, and the
 * only way to a notehead is to look at the pixels.
 *
 * Everything here works on a binary raster — one byte per pixel, 1 where
 * there is ink — and returns positions in that raster's own coordinates,
 * with Y increasing downward the way an image does. Turning those into the
 * PDF's upward-Y points is done at the edge, in `scanInk.ts`, so that the
 * arithmetic in here never has to think about it.
 *
 * The operations are the ones that survive a real scan: measure the skew and
 * take it out, find the staff lines, take them off the page, and then look
 * for shapes at the size the staff spacing implies. Every threshold is
 * written as a fraction of that spacing rather than in pixels, because a
 * scan may be 200dpi or 600dpi and nothing else about it is known.
 */

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel, row-major: 1 where there is ink. */
  readonly ink: Uint8Array;
}

/** A blob of ink: the box it sits in, and where its middle is. */
export interface Blob {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly centerX: number;
  readonly centerY: number;
  /** Ink pixels in the blob, which is not the same as the box's area. */
  readonly area: number;
}

/** A band of rows holding one staff line. */
export interface LineBand {
  readonly top: number;
  readonly bottom: number;
  readonly y: number;
  /** How far the line reaches, in raster x. */
  readonly x0: number;
  readonly x1: number;
}

/** Five line bands, with the spacing measured from them. */
export interface RasterStaff {
  readonly lines: readonly LineBand[];
  readonly spacing: number;
  readonly x0: number;
  readonly x1: number;
}

export function rasterAt(raster: Raster, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 0;
  return raster.ink[y * raster.width + x] ?? 0;
}

/**
 * A binary raster from rendered pixels.
 *
 * Takes RGBA as a canvas hands it over. Anything darker than the threshold
 * counts as ink; a scan of printed music is nearly black on nearly white and
 * nothing here needs to be cleverer than that. Transparent pixels are paper:
 * a PDF page rendered without a background leaves the margins transparent,
 * and treating those as ink would make the whole page one blob.
 */
export function rasterFromPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold = 140,
): Raster {
  const ink = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    const alpha = pixels[p + 3] ?? 255;
    if (alpha < 128) continue;
    const r = pixels[p] ?? 255;
    const g = pixels[p + 1] ?? 255;
    const b = pixels[p + 2] ?? 255;
    // Rec. 601 luma, near enough: a scan is grey anyway.
    if ((r * 299 + g * 587 + b * 114) / 1000 < threshold) ink[i] = 1;
  }
  return { width, height, ink };
}

/** Half a raster, each way. Used to measure skew without paying for it. */
export function halve(raster: Raster): Raster {
  const width = raster.width >> 1;
  const height = raster.height >> 1;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const a = y * 2 * raster.width;
    const b = a + raster.width;
    for (let x = 0; x < width; x++) {
      const i = x * 2;
      // Any ink in the 2×2 wins: staff lines are one or two pixels thick and
      // averaging would lose them, which is the one thing that must survive.
      ink[y * width + x] =
        raster.ink[a + i] || raster.ink[a + i + 1] || raster.ink[b + i] || raster.ink[b + i + 1]
          ? 1
          : 0;
    }
  }
  return { width, height, ink };
}

/**
 * How much the page is tilted, as a slope (rise over run), not an angle.
 *
 * A scan is never quite square, and a tilt of a third of a degree is enough
 * to smear a staff line across three rows — which turns the one thing that
 * should be a clean horizontal signal into a faint smudge, and the line
 * finding below into guesswork. Half a degree was what the first real scan
 * tested here had.
 *
 * Found by shearing the page through a range of slopes and asking which one
 * makes the rows most uneven. A page with level staff lines has a few rows
 * carrying a great deal of ink and most carrying little; tilt it and that
 * ink spreads out. The sum of squared row totals is largest exactly when it
 * is most concentrated, which is the standard projection-profile measure.
 */
export function estimateSlope(raster: Raster, limit = 0.03, step = 0.0015): number {
  const small = raster.width > 1200 ? halve(raster) : raster;
  const coarse = search(small, -limit, limit, step);
  return search(small, coarse - step, coarse + step, step / 8);
}

function search(raster: Raster, from: number, to: number, step: number): number {
  let best = from;
  let bestScore = -1;
  for (let slope = from; slope <= to + 1e-9; slope += step) {
    const score = spread(raster, slope);
    if (score > bestScore) {
      bestScore = score;
      best = slope;
    }
  }
  return best;
}

/** How concentrated the ink is in rows, once sheared by `slope`. */
function spread(raster: Raster, slope: number): number {
  const rows = new Float64Array(raster.height);
  // Every fourth column: the measure is a sum over the whole page, and a
  // quarter of it points the same way for a quarter of the work.
  for (let x = 0; x < raster.width; x += 4) {
    const shift = Math.round(x * slope);
    for (let y = 0; y < raster.height; y++) {
      if (!raster.ink[y * raster.width + x]) continue;
      const row = y + shift;
      if (row >= 0 && row < raster.height) rows[row] = (rows[row] ?? 0) + 1;
    }
  }
  let score = 0;
  for (const value of rows) score += value * value;
  return score;
}

/**
 * The tilt of each part of the page, measured separately down it.
 *
 * One number for the whole page is not enough for a real scan. A book is
 * photographed open, so the paper curves away from the glass and the tilt
 * changes down the page; and a page assembled from two exposures — which is
 * how the scan tested here was made — has a different tilt in each half.
 * Correcting the average leaves the top and bottom smeared, and a staff
 * line smeared over three rows is no longer a line that can be found.
 *
 * So the page is measured in bands and the tilt between band centres is
 * taken as sliding smoothly from one to the next, which is what a curving
 * page does.
 */
export function slopeProfile(raster: Raster, bands = 6): number[] {
  const overall = estimateSlope(raster);
  let total = 0;
  for (const value of raster.ink) total += value;
  const average = total / bands;
  const slopes: number[] = [];
  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor((raster.height * i) / bands);
    const y1 = Math.floor((raster.height * (i + 1)) / bands);
    const part = {
      width: raster.width,
      height: y1 - y0,
      ink: raster.ink.subarray(y0 * raster.width, y1 * raster.width),
    };
    let here = 0;
    for (const value of part.ink) here += value;
    // A band holding a title, a blank margin or a line of small print has
    // nothing long and straight in it to measure against, and the answer
    // comes back wild. The page's own tilt is a far better guess than that.
    slopes.push(here < average * 0.4 ? overall : estimateSlope(part));
  }
  return slopes;
}

/** The tilt at a row, sliding between the band centres either side of it. */
export function slopeAt(profile: readonly number[], y: number, height: number): number {
  if (profile.length === 0) return 0;
  if (profile.length === 1) return profile[0]!;
  const band = height / profile.length;
  const position = y / band - 0.5;
  const low = Math.max(0, Math.min(profile.length - 1, Math.floor(position)));
  const high = Math.max(0, Math.min(profile.length - 1, low + 1));
  const t = Math.max(0, Math.min(1, position - low));
  return profile[low]! * (1 - t) + profile[high]! * t;
}

/**
 * Straighten the page, using a tilt that varies down it.
 *
 * Written as a pull rather than a push — every output pixel asks where it
 * came from — because with the tilt changing from row to row a push leaves
 * gaps, and a gap in a staff line is exactly the damage this is meant to
 * undo.
 */
export function deskewProfile(raster: Raster, profile: readonly number[]): Raster {
  const ink = new Uint8Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y++) {
    const slope = slopeAt(profile, y, raster.height);
    const row = y * raster.width;
    for (let x = 0; x < raster.width; x++) {
      const from = y - Math.round(x * slope);
      if (from < 0 || from >= raster.height) continue;
      if (raster.ink[from * raster.width + x]) ink[row + x] = 1;
    }
  }
  return { width: raster.width, height: raster.height, ink };
}

/**
 * Take the tilt out, by shearing rather than rotating.
 *
 * For the angles a scanner produces — under a degree — a rotation and a
 * vertical shear differ by less than a pixel across a page, and a shear is
 * one integer add per pixel with no resampling, so nothing is blurred and
 * no thin line is lost to interpolation.
 */
export function deskew(raster: Raster, slope: number): Raster {
  if (Math.abs(slope) < 1e-5) return raster;
  const ink = new Uint8Array(raster.width * raster.height);
  for (let x = 0; x < raster.width; x++) {
    const shift = Math.round(x * slope);
    for (let y = 0; y < raster.height; y++) {
      if (!raster.ink[y * raster.width + x]) continue;
      const row = y + shift;
      if (row >= 0 && row < raster.height) ink[row * raster.width + x] = 1;
    }
  }
  return { width: raster.width, height: raster.height, ink };
}

/**
 * The longest stretch of a row that is ink, allowing small gaps.
 *
 * A staff line is crossed by stems and covered by noteheads, and a scan
 * leaves pinholes in it besides, so "how much of this row is ink" is not the
 * question — "how far does this row run" is. The gap allowance is what makes
 * a line interrupted by a barline still read as one line.
 */
export function longestRun(raster: Raster, y: number, gap: number): { length: number; x0: number; x1: number } {
  const row = y * raster.width;
  let best = 0;
  let bestStart = 0;
  let bestEnd = 0;
  let start = -1;
  let last = -1;
  for (let x = 0; x < raster.width; x++) {
    if (!raster.ink[row + x]) continue;
    if (start === -1 || x - last > gap) {
      start = x;
    }
    last = x;
    if (last - start > best) {
      best = last - start;
      bestStart = start;
      bestEnd = last;
    }
  }
  return { length: best, x0: bestStart, x1: bestEnd };
}

/**
 * The rows that hold staff lines.
 *
 * A row belongs to a staff line when it runs nearly the width of the drawn
 * music. That is a much stronger test than counting ink — a dense bar of
 * sixteenths puts more ink in a row than a staff line does, but it does not
 * run from one end of the system to the other.
 */
export function findLineBands(raster: Raster, minFraction = 0.35): LineBand[] {
  const gap = Math.max(4, Math.round(raster.width * 0.01));
  const runs: { length: number; x0: number; x1: number }[] = [];
  let longest = 0;
  for (let y = 0; y < raster.height; y++) {
    const run = longestRun(raster, y, gap);
    runs.push(run);
    if (run.length > longest) longest = run.length;
  }
  // Measured against the longest run on the page rather than against the
  // page width: a scan has margins, and a photocopy has black edges.
  const threshold = Math.max(raster.width * minFraction, longest * 0.6);

  const bands: LineBand[] = [];
  let top = -1;
  for (let y = 0; y <= raster.height; y++) {
    const isLine = y < raster.height && (runs[y]?.length ?? 0) >= threshold;
    if (isLine && top === -1) top = y;
    if (!isLine && top !== -1) {
      const bottom = y - 1;
      // How far the line reaches, not how far its longest unbroken stretch
      // reaches. A line interrupted near one end — by a barline, a heavy
      // chord, a fold in the paper — still belongs to the whole staff, and
      // reporting the longest stretch instead would leave the notes beyond
      // the break outside the staff's reach and looking for another one,
      // which is how a note on the top line comes back three octaves down.
      let from = raster.width;
      let to = -1;
      for (let row = top; row <= bottom; row++) {
        const line = row * raster.width;
        for (let x = 0; x < raster.width; x++) {
          if (!raster.ink[line + x]) continue;
          if (x < from) from = x;
          if (x > to) to = x;
        }
      }
      const fallback = runs[Math.round((top + bottom) / 2)] ?? runs[top]!;
      bands.push({
        top,
        bottom,
        y: (top + bottom) / 2,
        x0: to === -1 ? fallback.x0 : from,
        x1: to === -1 ? fallback.x1 : to,
      });
      top = -1;
    }
  }
  return bands;
}

/**
 * Bands gathered into staves of five.
 *
 * The gap inside a staff is one space; the gap to the next staff is several.
 * Rather than guessing a threshold, the spacing is taken as the median gap
 * over the whole page — every staff on a page is the same size — and a new
 * staff begins wherever a gap is more than twice it. Anything that does not
 * come out at exactly five lines is dropped: a four-line staff would put
 * every pitch on it out by a step, silently, which is worse than admitting
 * the page was not read.
 */
export function groupRasterStaves(bands: readonly LineBand[]): RasterStaff[] {
  if (bands.length < 5) return [];
  const gaps = bands.slice(1).map((band, i) => band.y - bands[i]!.y);
  const sorted = [...gaps].sort((a, b) => a - b);
  // The inner gaps outnumber the between-staff ones four to one, so the
  // lower quartile is safely inside a staff.
  const spacing = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  if (spacing <= 0) return [];

  const staves: RasterStaff[] = [];
  let current: LineBand[] = [bands[0]!];
  for (let i = 1; i < bands.length; i++) {
    const band = bands[i]!;
    if (band.y - bands[i - 1]!.y <= spacing * 2) current.push(band);
    else {
      staves.push(...asStaves(current));
      current = [band];
    }
  }
  staves.push(...asStaves(current));
  return staves;
}

/** A run of bands becomes a staff only when there are exactly five of them. */
function asStaves(bands: readonly LineBand[]): RasterStaff[] {
  if (bands.length !== 5) return [];
  const gaps = bands.slice(1).map((band, i) => band.y - bands[i]!.y);
  const spacing = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return [
    {
      lines: bands,
      spacing,
      x0: Math.min(...bands.map((b) => b.x0)),
      x1: Math.max(...bands.map((b) => b.x1)),
    },
  ];
}

/**
 * Rub the staff lines out.
 *
 * A notehead sitting on a line, a stem crossing one and a slur touching one
 * all have to survive; only the line itself may go. The test is thickness,
 * measured where the line actually is: follow the ink up and down from the
 * line in each column, and erase what comes back no thicker than a line.
 * Where a symbol crosses, the run is many times longer and is left alone,
 * so a stem stays whole instead of being cut into pieces the way erasing a
 * whole row would cut it.
 *
 * Asking instead whether there is ink a few pixels above or below — the
 * obvious test — does not work: a line is two or three pixels thick and its
 * own thickness answers yes, so nothing is ever erased.
 */
export function removeStaffLines(
  raster: Raster,
  bands: readonly LineBand[],
  maxThickness = 0,
): Raster {
  const ink = Uint8Array.from(raster.ink);
  const thickest =
    maxThickness > 0
      ? maxThickness
      : Math.max(2, Math.round(median(bands.map((band) => band.bottom - band.top + 1)) * 2 + 1));
  for (const band of bands) {
    for (let x = 0; x < raster.width; x++) {
      // Follow the ink up and down from the line to find how thick it is
      // here. A line on its own is two or three pixels; where a stem, a
      // notehead or a slur crosses it the run is far longer, and that is
      // the symbol, which has to stay.
      let top = band.top;
      let bottom = band.bottom;
      if (!ink[top * raster.width + x] && !ink[bottom * raster.width + x]) {
        let found = false;
        for (let y = band.top; y <= band.bottom; y++) {
          if (ink[y * raster.width + x]) {
            top = y;
            bottom = y;
            found = true;
            break;
          }
        }
        if (!found) continue;
      }
      while (top > 0 && ink[(top - 1) * raster.width + x]) top--;
      while (bottom + 1 < raster.height && ink[(bottom + 1) * raster.width + x]) bottom++;
      if (bottom - top + 1 > thickest) continue;
      for (let y = top; y <= bottom; y++) ink[y * raster.width + x] = 0;
    }
  }
  return { width: raster.width, height: raster.height, ink };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Summed-area table, so that any box's ink can be totted up in four reads.
 *
 * Both of the shape operations below are "is this whole box ink" or "is any
 * of this box ink", asked once per pixel. Answering those by looking at the
 * box would cost the box's area every time; answering them from a table
 * costs the page once.
 */
function integral(raster: Raster): Int32Array {
  const w = raster.width + 1;
  const table = new Int32Array(w * (raster.height + 1));
  for (let y = 0; y < raster.height; y++) {
    let row = 0;
    for (let x = 0; x < raster.width; x++) {
      row += raster.ink[y * raster.width + x] ?? 0;
      table[(y + 1) * w + x + 1] = (table[y * w + x + 1] ?? 0) + row;
    }
  }
  return table;
}

function boxSum(table: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  return (
    (table[(y1 + 1) * w + x1 + 1] ?? 0) -
    (table[y0 * w + x1 + 1] ?? 0) -
    (table[(y1 + 1) * w + x0] ?? 0) +
    (table[y0 * w + x0] ?? 0)
  );
}

/**
 * Keep only ink that a rectangle of this size fits inside.
 *
 * A morphological opening, which is the shape filter this needs: it wipes
 * out everything thinner than the rectangle in either direction and leaves
 * everything fatter roughly where it was. Sized just under a notehead, it
 * erases stems (too narrow), beams and slurs (too thin), ledger lines and
 * text, and leaves the noteheads.
 *
 * Done with a summed-area table in two passes, so the cost does not grow
 * with the size of the rectangle — which matters, because on a 300dpi scan
 * the rectangle is around fifteen pixels each way and the page is four
 * million pixels.
 */
export function openRect(raster: Raster, boxWidth: number, boxHeight: number): Raster {
  const kw = Math.max(1, Math.round(boxWidth));
  const kh = Math.max(1, Math.round(boxHeight));
  const w = raster.width + 1;
  const table = integral(raster);
  const area = kw * kh;
  const halfW = kw >> 1;
  const halfH = kh >> 1;

  // Erode: a pixel survives where the whole rectangle around it is ink.
  const eroded = new Uint8Array(raster.width * raster.height);
  for (let y = 0; y < raster.height; y++) {
    const y0 = y - halfH;
    const y1 = y0 + kh - 1;
    if (y0 < 0 || y1 >= raster.height) continue;
    for (let x = 0; x < raster.width; x++) {
      const x0 = x - halfW;
      const x1 = x0 + kw - 1;
      if (x0 < 0 || x1 >= raster.width) continue;
      if (boxSum(table, w, x0, y0, x1, y1) === area) eroded[y * raster.width + x] = 1;
    }
  }

  // Dilate what survived, by the same rectangle, putting the shapes back to
  // about their original size.
  const back: Raster = { width: raster.width, height: raster.height, ink: eroded };
  const grown = new Uint8Array(raster.width * raster.height);
  const table2 = integral(back);
  for (let y = 0; y < raster.height; y++) {
    const y0 = Math.max(0, y - halfH);
    const y1 = Math.min(raster.height - 1, y0 + kh - 1);
    for (let x = 0; x < raster.width; x++) {
      const x0 = Math.max(0, x - halfW);
      const x1 = Math.min(raster.width - 1, x0 + kw - 1);
      if (boxSum(table2, w, x0, y0, x1, y1) > 0) grown[y * raster.width + x] = 1;
    }
  }
  return { width: raster.width, height: raster.height, ink: grown };
}

/**
 * Connected blobs of ink, four-connected.
 *
 * Written as an explicit stack rather than by recursion: a blob on a 300dpi
 * page can run to thousands of pixels, and the call stack is not the place
 * to find that out.
 */
export function blobs(raster: Raster, minArea = 1): Blob[] {
  const seen = new Uint8Array(raster.width * raster.height);
  const found: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < raster.ink.length; start++) {
    if (!raster.ink[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    let x0 = raster.width;
    let x1 = 0;
    let y0 = raster.height;
    let y1 = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const x = at % raster.width;
      const y = (at - x) / raster.width;
      area++;
      sumX += x;
      sumY += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && raster.ink[at - 1] && !seen[at - 1]) {
        seen[at - 1] = 1;
        stack.push(at - 1);
      }
      if (x + 1 < raster.width && raster.ink[at + 1] && !seen[at + 1]) {
        seen[at + 1] = 1;
        stack.push(at + 1);
      }
      const up = at - raster.width;
      if (y > 0 && raster.ink[up] && !seen[up]) {
        seen[up] = 1;
        stack.push(up);
      }
      const down = at + raster.width;
      if (y + 1 < raster.height && raster.ink[down] && !seen[down]) {
        seen[down] = 1;
        stack.push(down);
      }
    }
    if (area >= minArea) {
      found.push({ x0, y0, x1, y1, centerX: sumX / area, centerY: sumY / area, area });
    }
  }
  return found;
}

/**
 * Holes: paper with ink all the way round it.
 *
 * What a half note is, once its stem and the staff lines are out of the way.
 * Found by flooding the paper inward from the edges of the page; whatever
 * paper the flood cannot reach is enclosed.
 */
export function holes(raster: Raster, minArea = 1): Blob[] {
  const paper: Uint8Array = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < paper.length; i++) paper[i] = raster.ink[i] ? 0 : 1;
  const outside: Raster = { width: raster.width, height: raster.height, ink: paper };
  const seen = new Uint8Array(paper.length);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const at = y * raster.width + x;
    if (paper[at] && !seen[at]) {
      seen[at] = 1;
      stack.push(at);
    }
  };
  for (let x = 0; x < raster.width; x++) {
    push(x, 0);
    push(x, raster.height - 1);
  }
  for (let y = 0; y < raster.height; y++) {
    push(0, y);
    push(raster.width - 1, y);
  }
  while (stack.length > 0) {
    const at = stack.pop()!;
    const x = at % raster.width;
    const y = (at - x) / raster.width;
    if (x > 0) push(x - 1, y);
    if (x + 1 < raster.width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < raster.height) push(x, y + 1);
  }
  for (let i = 0; i < paper.length; i++) if (seen[i]) paper[i] = 0;
  return blobs(outside, minArea);
}

/**
 * Vertical strokes: stems, barlines, and the brace down the left of a
 * system. Anything taller than it is wide, found by walking each column.
 *
 * Kept separate from the blob finder because a stem is almost always joined
 * to something — a notehead, a beam, the next stem along — and as a blob it
 * would come back as whatever it is attached to. As a column of ink it is
 * itself.
 */
export function verticalRuns(
  raster: Raster,
  minHeight: number,
  maxWidth: number,
): { x: number; y0: number; y1: number }[] {
  const runs: { x: number; y0: number; y1: number }[] = [];
  const gap = 2;
  for (let x = 0; x < raster.width; x++) {
    let start = -1;
    let last = -1;
    for (let y = 0; y <= raster.height; y++) {
      const inked = y < raster.height && raster.ink[y * raster.width + x];
      if (inked) {
        if (start === -1 || y - last > gap) {
          if (start !== -1 && last - start >= minHeight) runs.push({ x, y0: start, y1: last });
          start = y;
        }
        last = y;
      } else if (start !== -1 && (y - last > gap || y === raster.height)) {
        if (last - start >= minHeight) runs.push({ x, y0: start, y1: last });
        start = -1;
      }
    }
  }
  // Columns next to each other that cover the same rows are one stroke, and
  // a stroke wider than a stem is a bracket or an edge, not a stem.
  const merged: { x: number; y0: number; y1: number; width: number }[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      run.x === last.x + last.width &&
      Math.abs(run.y0 - last.y0) <= gap &&
      Math.abs(run.y1 - last.y1) <= gap
    ) {
      last.width += 1;
      continue;
    }
    merged.push({ x: run.x, y0: run.y0, y1: run.y1, width: 1 });
  }
  return merged
    .filter((run) => run.width <= maxWidth)
    .map((run) => ({ x: run.x + (run.width - 1) / 2, y0: run.y0, y1: run.y1 }));
}

/**
 * Rub out the stems and barlines.
 *
 * The mirror of taking the staff lines off, and needed for the same reason:
 * with the lines gone, a whole system is still one connected blob of ink,
 * because every stem joins its notehead to a beam, every beam joins the
 * next stem along, and the barline down the left joins the two staves of the
 * grand staff to each other. Nothing can be identified by its shape while it
 * is part of that.
 *
 * The test is horizontal support, as the line rule was vertical: ink in a
 * narrow vertical run goes unless the symbol it belongs to carries on to the
 * left or the right of it, which is what keeps a notehead whole when its own
 * stem is taken away.
 */
export function removeVerticalRuns(
  raster: Raster,
  runs: readonly { x: number; y0: number; y1: number }[],
  width: number,
): Raster {
  const ink = Uint8Array.from(raster.ink);
  const reach = Math.max(2, Math.ceil(width) + 2);
  const half = Math.ceil(width / 2);
  for (const run of runs) {
    const from = Math.round(run.x - half);
    const to = Math.round(run.x + half);
    for (let y = run.y0; y <= run.y1; y++) {
      for (let x = from; x <= to; x++) {
        if (x < 0 || x >= raster.width) continue;
        if (!ink[y * raster.width + x]) continue;
        if (rasterAt(raster, from - reach, y) || rasterAt(raster, to + reach, y)) continue;
        ink[y * raster.width + x] = 0;
      }
    }
  }
  return { width: raster.width, height: raster.height, ink };
}

/** A run of neighbouring columns that carry ink, and what they hold. */
export interface ColumnGroup {
  readonly x0: number;
  readonly x1: number;
  /** Topmost and bottommost ink in the group, and how much there is. */
  readonly top: number;
  readonly bottom: number;
  readonly area: number;
}

/**
 * The page cut into vertical slices of ink, left to right.
 *
 * What the start of a staff needs, and what connected blobs cannot give it:
 * a clef, a key signature and a time signature stand side by side in their
 * own columns, in that order, always — but they touch the staff lines, they
 * touch slurs, and once the lines are gone a clef often falls into several
 * pieces. Cutting by column ignores all of that. It asks only where the ink
 * starts and stops along the staff, which is the one thing the engraver's
 * layout guarantees.
 */
export function columnGroups(
  raster: Raster,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  gap: number,
): ColumnGroup[] {
  const from = Math.max(0, Math.round(x0));
  const to = Math.min(raster.width - 1, Math.round(x1));
  const top = Math.max(0, Math.round(y0));
  const bottom = Math.min(raster.height - 1, Math.round(y1));
  const groups: ColumnGroup[] = [];
  let start = -1;
  let last = -1;
  let seenTop = Infinity;
  let seenBottom = -Infinity;
  let area = 0;
  const close = () => {
    if (start === -1) return;
    groups.push({ x0: start, x1: last, top: seenTop, bottom: seenBottom, area });
    start = -1;
    seenTop = Infinity;
    seenBottom = -Infinity;
    area = 0;
  };
  for (let x = from; x <= to + 1; x++) {
    let columnTop = Infinity;
    let columnBottom = -Infinity;
    let columnInk = 0;
    if (x <= to) {
      for (let y = top; y <= bottom; y++) {
        if (!raster.ink[y * raster.width + x]) continue;
        columnInk++;
        if (y < columnTop) columnTop = y;
        if (y > columnBottom) columnBottom = y;
      }
    }
    if (columnInk > 0) {
      if (start !== -1 && x - last > gap) close();
      if (start === -1) start = x;
      last = x;
      area += columnInk;
      if (columnTop < seenTop) seenTop = columnTop;
      if (columnBottom > seenBottom) seenBottom = columnBottom;
    } else if (start !== -1 && x - last > gap) {
      close();
    }
  }
  close();
  return groups;
}

/**
 * Cut the staff-line rows out altogether, symbols and all.
 *
 * Deliberately cruder than `removeStaffLines`, and for a different job. That
 * one keeps every symbol whole, at the price of leaving a stub of line
 * wherever something crosses it — which is the right trade when the shapes
 * matter. But those stubs join everything at the start of a staff into one
 * run of columns: brace, barline, clef and key signature all bridged by
 * scraps of line, so that nothing can be told apart by where it begins and
 * ends.
 *
 * For that question the lines are simply removed, rows and all. A symbol
 * comes back in pieces, which does not matter: what is being asked is how
 * far along the staff each thing reaches, and the pieces of one symbol still
 * stand in its own columns.
 */
export function stripLineRows(raster: Raster, bands: readonly LineBand[], pad = 1): Raster {
  const ink = Uint8Array.from(raster.ink);
  for (const band of bands) {
    const top = Math.max(0, band.top - pad);
    const bottom = Math.min(raster.height - 1, band.bottom + pad);
    for (let y = top; y <= bottom; y++) ink.fill(0, y * raster.width, (y + 1) * raster.width);
  }
  return { width: raster.width, height: raster.height, ink };
}
