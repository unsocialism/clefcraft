/**
 * Reading a scanned page into the same shape a drawn one comes in.
 *
 * The rest of the PDF reader works on a `PageInk`: staff-line rules, the
 * vertical strokes that make barlines, and glyphs with positions. A PDF
 * exported from notation software hands all of that over for free, and a
 * scan hands over nothing at all — one picture, in which a notehead is a
 * smudge that happens to be about as wide as the staff spacing.
 *
 * So this finds those things in the picture and writes them out in exactly
 * the form the drawn path produces, down to using the SMuFL characters for
 * the glyphs it recognises. Everything downstream — staves, clefs, key
 * signatures, measures, pitch from height, the page overlay, the
 * correct-the-notes editing, the export — then works on a scan without
 * knowing it is one.
 *
 * What it does not read is rhythm, which is no loss here: the PDF path has
 * never read rhythm from a drawn score either, so a scan arrives in the same
 * state as any other PDF — the notes and their order, with every event given
 * the same nominal length.
 *
 * Raster coordinates run down the page and PDF coordinates run up it. The
 * conversion happens once, at the bottom of this file, so that everything
 * above can think in pixels.
 */

import type { Glyph, PageInk, Rule, Stroke } from './glyphs.ts';
import {
  blobs,
  columnGroups,
  deskewProfile,
  slopeProfile,
  findLineBands,
  groupRasterStaves,
  holes,
  openRect,
  removeStaffLines,
  removeVerticalRuns,
  stripLineRows,
  verticalRuns,
  type Blob,
  type LineBand,
  type Raster,
  type RasterStaff,
} from './raster.ts';

/** The SMuFL characters the drawn path already knows how to read. */
const NOTEHEAD_FILLED = '';
const NOTEHEAD_HOLLOW = '';
const CLEF_TREBLE = '';
const CLEF_BASS = '';
const ACCIDENTAL = { flat: '', natural: '', sharp: '' } as const;

/** A notehead found in the picture, before it becomes a glyph. */
interface Head {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly hollow: boolean;
}

export interface ScanResult {
  readonly ink: PageInk;
  /** What was found, for the diagnostics panel and for tests. */
  readonly report: ScanReport;
}

export interface ScanReport {
  /** The tilt taken out of the page, in degrees. */
  readonly skewDegrees: number;
  readonly staves: number;
  readonly spacing: number;
  readonly filledHeads: number;
  readonly hollowHeads: number;
  readonly clefs: number;
  readonly keyAccidentals: number;
  readonly noteAccidentals: number;
}

export interface ScanOptions {
  /** The page's width and height in PDF points, for the conversion back. */
  readonly pageWidth: number;
  readonly pageHeight: number;
}

/**
 * What a staff position is worth, counted in half-spaces from the bottom
 * line upward — the same ladder `staffGeometry` climbs, kept here so the key
 * signature can be matched by position without leaving raster coordinates.
 */
function halfSpacesAbove(y: number, staff: RasterStaff): number {
  const bottom = staff.lines[4]!.y;
  return (bottom - y) / (staff.spacing / 2);
}

/**
 * The two standard key signatures, as the half-space positions their
 * accidentals stand on, in the order they are always written.
 *
 * Reading a key signature by matching positions rather than by telling a
 * sharp from a flat is what makes it work on a scan: at three hundred dots
 * an inch a sharp and a natural differ by a few pixels of slant, while a
 * sharp on the top line and a flat on the middle line are four half-spaces
 * apart and cannot be confused. The engraver has no freedom here — these
 * positions are fixed by convention, which is exactly what makes them
 * evidence.
 */
const SHARP_ORDER: Record<'treble' | 'bass', readonly number[]> = {
  // F C G D A E B, from the top line down for a treble clef.
  treble: [8, 5, 9, 6, 3, 7, 4],
  bass: [6, 3, 7, 4, 1, 5, 2],
};
const FLAT_ORDER: Record<'treble' | 'bass', readonly number[]> = {
  // B E A D G C F.
  treble: [4, 7, 3, 6, 2, 5, 1],
  bass: [2, 5, 1, 4, 0, 3, -1],
};

/** How well a run of positions matches a signature of `count` accidentals. */
function signatureError(
  found: readonly number[],
  wanted: readonly number[],
  count: number,
): number | null {
  if (found.length !== count) return null;
  let worst = 0;
  for (const [i, position] of found.entries()) {
    const error = Math.abs(position - (wanted[i] ?? 0));
    if (error > worst) worst = error;
  }
  return worst;
}

/**
 * Which key signature the accidentals after the clef spell out.
 *
 * Tries every signature from seven flats to seven sharps and takes the one
 * whose positions are nearest. Half a half-space of slack absorbs a scan's
 * wobble; more than that and it is not a key signature at all — a stray mark
 * matched loosely would transpose the whole line.
 */
export function readKeySignature(
  positions: readonly number[],
  clef: 'treble' | 'bass',
): { fifths: number; alter: -1 | 1 } | null {
  if (positions.length === 0 || positions.length > 7) return null;
  let best: { fifths: number; alter: -1 | 1; error: number } | null = null;
  for (const count of [positions.length]) {
    const sharp = signatureError(positions, SHARP_ORDER[clef], count);
    if (sharp !== null && (!best || sharp < best.error)) {
      best = { fifths: count, alter: 1, error: sharp };
    }
    const flat = signatureError(positions, FLAT_ORDER[clef], count);
    if (flat !== null && (!best || flat < best.error)) {
      best = { fifths: -count, alter: -1, error: flat };
    }
  }
  if (!best || best.error > 0.75) return null;
  return { fifths: best.fifths, alter: best.alter };
}

/**
 * Which clef stands at the start of a staff.
 *
 * Told apart by where the symbol puts its ink rather than by its outline. A
 * treble clef is drawn around the G line and its tail loops well below the
 * bottom of the staff; a bass clef sits on the F line near the top and never
 * goes below the middle. So the question "how much ink is there under this
 * staff, in the space before the first note?" separates them outright, and
 * it survives a scan that has blurred every curve — where matching outlines
 * would need a classifier and a training set.
 */
export function clefFromInk(below: number, above: number, spacing: number): 'treble' | 'bass' | null {
  const enough = spacing * spacing * 0.25;
  if (below > enough && below > above * 0.35) return 'treble';
  if (above > enough && below < enough) return 'bass';
  return null;
}

/** Ink columns in a window, as the first and last row that carry any. */
function extentIn(
  raster: Raster,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { top: number; bottom: number; count: number } {
  let top = Infinity;
  let bottom = -Infinity;
  let count = 0;
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(raster.height - 1, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(raster.width - 1, Math.round(x1)); x++) {
      if (!raster.ink[y * raster.width + x]) continue;
      count++;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { top, bottom, count };
}

/**
 * Noteheads.
 *
 * A filled head is the one shape on the page that a rectangle a little
 * smaller than it fits inside: stems and barlines are too narrow, beams,
 * slurs, ties and ledger lines too thin, and letters too small. So opening
 * the page with that rectangle leaves the heads and takes away nearly
 * everything else — no template, no classifier, and nothing to tune but the
 * staff spacing, which has already been measured.
 *
 * A hollow head is the same shape with the middle left out, so it does not
 * survive the opening at all; it is found as a piece of enclosed paper
 * instead, once the stems are out of the way.
 */
function findHeads(noLines: Raster, noStems: Raster, spacing: number): Head[] {
  const heads: Head[] = [];
  const filled = openRect(noLines, spacing * 0.85, spacing * 0.62);
  for (const blob of blobs(filled, Math.round(spacing * spacing * 0.25))) {
    const width = blob.x1 - blob.x0 + 1;
    const height = blob.y1 - blob.y0 + 1;
    if (width > spacing * 2.6 || height > spacing * 2.0 || height < spacing * 0.45) continue;
    heads.push({
      x: blob.centerX,
      // Where the head really sits, not where what is left of it after the
      // opening sits. Half a space of error here is a whole step of pitch,
      // so the height is measured again on the untouched ink, down a narrow
      // band through the middle of the head — narrow enough to miss the
      // stem, which stands at its side and would drag the answer up or down
      // depending on which way the stem happened to go.
      y: centreOfInk(noLines, blob.centerX, blob.centerY, spacing * 0.42, spacing * 0.75) ?? blob.centerY,
      width: Math.min(width, spacing * 1.4),
      hollow: false,
    });
  }

  for (const hole of holes(noStems, Math.round(spacing * spacing * 0.08))) {
    const width = hole.x1 - hole.x0 + 1;
    const height = hole.y1 - hole.y0 + 1;
    if (width < spacing * 0.35 || width > spacing * 1.3) continue;
    if (height < spacing * 0.25 || height > spacing * 1.0) continue;
    // Wider than it is tall, as an oblique ellipse seen from the front: the
    // holes inside a clef or a numeral are as tall as they are wide.
    if (height > width * 0.95) continue;
    if (heads.some((head) => Math.abs(head.x - hole.centerX) < spacing && Math.abs(head.y - hole.centerY) < spacing * 0.6)) {
      continue;
    }
    heads.push({ x: hole.centerX, y: hole.centerY, width: spacing * 1.25, hollow: true });
  }
  return heads;
}

/**
 * The middle of the ink in a small box, weighted by how much there is.
 *
 * Used to place a notehead exactly. Returns nothing when the box is empty,
 * which leaves the caller with its first guess rather than a made-up answer.
 */
function centreOfInk(
  raster: Raster,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): number | null {
  const x0 = Math.max(0, Math.round(x - halfWidth));
  const x1 = Math.min(raster.width - 1, Math.round(x + halfWidth));
  const y0 = Math.max(0, Math.round(y - halfHeight));
  const y1 = Math.min(raster.height - 1, Math.round(y + halfHeight));
  let sum = 0;
  let count = 0;
  for (let row = y0; row <= y1; row++) {
    for (let column = x0; column <= x1; column++) {
      if (!raster.ink[row * raster.width + column]) continue;
      sum += row;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Which vertical runs are note stems: the ones standing on a notehead. */
function stemsOf(
  runs: readonly { x: number; y0: number; y1: number }[],
  heads: readonly Head[],
  staves: readonly RasterStaff[],
  spacing: number,
): { x: number; y0: number; y1: number }[] {
  const staffHeight = spacing * 4;
  return runs.filter((run) => {
    // A barline or a brace runs the height of a staff or more and is not
    // attached to any one note; taking it out is what separates the two
    // staves of a grand staff from each other.
    const tall = run.y1 - run.y0 >= staffHeight * 0.9;
    if (tall && staves.some((staff) => run.y0 <= staff.lines[0]!.y + spacing && run.y1 >= staff.lines[4]!.y - spacing)) {
      return true;
    }
    return heads.some(
      (head) =>
        Math.abs(head.x - run.x) < head.width * 0.75 &&
        (Math.abs(head.y - run.y0) < spacing * 1.2 || Math.abs(head.y - run.y1) < spacing * 1.2),
    );
  });
}

/**
 * Accidentals: the small tall marks that stand to the left of a notehead, or
 * in a row after the clef.
 *
 * Found as blobs of about the right proportions once the stems are gone —
 * roughly two spaces tall and under one wide. What kind of accidental each
 * one is is not decided here: in a key signature the positions say it, and
 * beside a note it is settled by shape below.
 */
function accidentalBlobs(noStems: Raster, spacing: number): Blob[] {
  return blobs(noStems, Math.round(spacing * spacing * 0.12)).filter((blob) => {
    const width = blob.x1 - blob.x0 + 1;
    const height = blob.y1 - blob.y0 + 1;
    return (
      height >= spacing * 1.3 &&
      height <= spacing * 3.2 &&
      width >= spacing * 0.25 &&
      width <= spacing * 1.25 &&
      height > width * 1.4
    );
  });
}

/**
 * Sharp, flat or natural, by where the ink sits inside the mark.
 *
 * A flat is a stem with a bowl hanging off the bottom of it, so its ink is
 * low and its widest row is well below its middle. A sharp and a natural are
 * both symmetric about their centre; the sharp is the wider of the two,
 * because its two uprights are a good part of a space apart while a
 * natural's are barely half that.
 */
export function classifyAccidental(
  raster: Raster,
  blob: Blob,
  spacing: number,
): 'sharp' | 'flat' | 'natural' {
  const height = blob.y1 - blob.y0 + 1;
  const width = blob.x1 - blob.x0 + 1;
  const middle = (blob.y0 + blob.y1) / 2;
  let upper = 0;
  let lower = 0;
  for (let y = blob.y0; y <= blob.y1; y++) {
    for (let x = blob.x0; x <= blob.x1; x++) {
      if (!raster.ink[y * raster.width + x]) continue;
      if (y < middle) upper++;
      else lower++;
    }
  }
  const bottomHeavy = lower > upper * 1.6;
  if (bottomHeavy && height > spacing * 1.4) return 'flat';
  return width >= spacing * 0.62 ? 'sharp' : 'natural';
}

/**
 * Everything read off one scanned page, before any of it is written out.
 *
 * Kept apart from the writing because of the key signature: a piece has one,
 * it is repeated on every line of every page, and the surest reading of it
 * is the one most of those lines agree on. That vote cannot be taken until
 * every page has been looked at, and looking is the expensive half.
 */
export interface PageAnalysis {
  readonly report: ScanReport;
  /** What each staff on the page holds, in the page's own coordinates. */
  readonly staves: readonly StaffAnalysis[];
  /** The key each staff reads on its own, where it could read one at all. */
  readonly keyCandidates: readonly number[];
  readonly spacing: number;
  readonly bands: readonly LineBand[];
  readonly runs: readonly { x: number; y0: number; y1: number }[];
  readonly heads: readonly Head[];
  readonly noteMarks: readonly { blob: Blob; kind: 'sharp' | 'flat' | 'natural'; staffOf: number }[];
  readonly options: ScanOptions;
  readonly raster: Raster;
}

interface StaffAnalysis {
  readonly staff: RasterStaff;
  readonly clef: { x: number; end: number; kind: 'treble' | 'bass' };
  readonly firstHead: number;
  readonly keyFrom: number | undefined;
}

export function analysePage(raster: Raster, options: ScanOptions): PageAnalysis {
  const profile = slopeProfile(raster);
  const flat = deskewProfile(raster, profile);
  const bands = findLineBands(flat);
  const staves = groupRasterStaves(bands);
  const slope = profile.reduce((sum, value) => sum + value, 0) / Math.max(1, profile.length);

  const empty: ScanReport = {
    skewDegrees: (Math.atan(slope) * 180) / Math.PI,
    staves: staves.length,
    spacing: 0,
    filledHeads: 0,
    hollowHeads: 0,
    clefs: 0,
    keyAccidentals: 0,
    noteAccidentals: 0,
  };
  if (staves.length === 0) {
    return {
      report: empty,
      staves: [],
      keyCandidates: [],
      spacing: 0,
      bands: [],
      runs: [],
      heads: [],
      noteMarks: [],
      options,
      raster: flat,
    };
  }

  const spacing = median(staves.map((staff) => staff.spacing));
  const noLines = removeStaffLines(flat, bands);
  const runs = verticalRuns(noLines, spacing * 1.1, Math.max(2, spacing * 0.3));
  const provisional = findHeads(noLines, noLines, spacing);
  const noStems = removeVerticalRuns(
    noLines,
    stemsOf(runs, provisional, staves, spacing),
    Math.max(2, spacing * 0.3),
  );
  const heads = findHeads(noLines, noStems, spacing).filter((head) => {
    const staff = staves.find((candidate) => withinReach(head.x, head.y, candidate));
    if (!staff) return false;
    // Away from the staff, a note carries a stem — and a letter of
    // "sempre legato" sitting in the gap between the staves does not. On the
    // staff the test is dropped, because a run of quavers can be read as one
    // beamed shape whose stems are not all found.
    if (outsideBy(head.y, staff) <= 2) return true;
    return hasStem(head, runs, spacing);
  });
  // The start of a staff is read on a copy with the line rows cut out
  // altogether: brace, barline, clef and key signature stand in their own
  // columns, and the scraps of line left between them would join the four
  // into one.
  const bare = stripLineRows(flat, bands);
  const marks = accidentalBlobs(noStems, spacing);

  // Clefs first, and only then the notes: the lower loop of a treble clef
  // is a filled blob of about a notehead's size, and read as one it comes
  // out as a note three octaves below anything the piece contains. Knowing
  // where the clef ends is what rules it out.
  const clefs = staves.map((staff, index) =>
    clefOn(bare, staff, index, spacing, staff.x0 + spacing * 7),
  );
  const playable = heads.filter((head) => {
    const index = staves.findIndex((staff) => onStaff(head.x, head.y, staff, spacing));
    const clef = clefs[index];
    return !clef || head.x > clef.end;
  });

  const analysed: StaffAnalysis[] = [];
  const keyCandidates: number[] = [];
  const noteMarks: { blob: Blob; kind: 'sharp' | 'flat' | 'natural'; staffOf: number }[] = [];

  for (const [index, staff] of staves.entries()) {
    const ownHeads = playable
      .filter((head) => onStaff(head.x, head.y, staff, spacing))
      .sort((a, b) => a.x - b.x);
    const firstHead = ownHeads[0]?.x ?? staff.x1;
    const clef = clefs[index]!;
    const after = keyZone(noStems, staff, spacing, clef.end, firstHead);
    const key = readKeySignature(
      after.map((group) => Math.round(halfSpacesAbove((group.top + group.bottom) / 2, staff))),
      clef.kind,
    );
    if (key) keyCandidates.push(key.fifths);
    analysed.push({ staff, clef, firstHead, keyFrom: after[0]?.x0 });

    for (const mark of marks) {
      if (mark.centerX <= firstHead - spacing * 0.3) continue;
      if (!onStaff(mark.centerX, mark.centerY, staff, spacing)) continue;
      const owner = ownHeads.find(
        (head) =>
          head.x - mark.centerX > 0 &&
          head.x - mark.centerX < spacing * 2.6 &&
          Math.abs(head.y - mark.centerY) < spacing * 0.4,
      );
      if (!owner) continue;
      noteMarks.push({ blob: mark, kind: classifyAccidental(noStems, mark, spacing), staffOf: index });
    }
  }

  return {
    report: {
      ...empty,
      spacing: spacing * (options.pageWidth / raster.width),
      filledHeads: playable.filter((head) => !head.hollow).length,
      hollowHeads: playable.filter((head) => head.hollow).length,
      clefs: analysed.length,
      keyAccidentals: 0,
      noteAccidentals: noteMarks.length,
    },
    staves: analysed,
    keyCandidates,
    spacing,
    bands,
    runs,
    heads: playable,
    noteMarks,
    options,
    raster: flat,
  };
}

/**
 * Write a page out as ink, using the key signature the whole document voted
 * for. The marks of the key are drawn in at the positions the convention
 * fixes rather than where each one happened to be found — they are the same
 * positions, which is what matching them established, and doing it this way
 * carries the reading on to the lines where the marks themselves were lost
 * in a slur or a smudge.
 */
export function inkFrom(analysis: PageAnalysis, fifths: number | null): ScanResult {
  const { spacing, bands, runs, heads, options } = analysis;
  const toPdf = mapper(analysis.raster, options);
  if (analysis.staves.length === 0) {
    return { ink: { rules: [], segments: [], strokes: [], glyphs: [] }, report: analysis.report };
  }

  const glyphs: Glyph[] = [];
  for (const head of heads) {
    glyphs.push({
      ch: head.hollow ? NOTEHEAD_HOLLOW : NOTEHEAD_FILLED,
      ...toPdf.glyph(head.x - head.width / 2, head.y),
      size: spacing * toPdf.scale * 4,
      advance: head.width * toPdf.scale,
    });
  }

  let keyAccidentals = 0;
  for (const entry of analysis.staves) {
    const { staff, clef, firstHead } = entry;
    glyphs.push({
      ch: clef.kind === 'treble' ? CLEF_TREBLE : CLEF_BASS,
      ...toPdf.glyph(clef.x, clefAnchor(clef.kind, staff)),
      size: spacing * toPdf.scale * 4,
      advance: spacing * 2.5 * toPdf.scale,
    });

    if (fifths !== null && fifths !== 0) {
      const order = fifths > 0 ? SHARP_ORDER[clef.kind] : FLAT_ORDER[clef.kind];
      const count = Math.min(7, Math.abs(fifths));
      // Between the clef and the first note, and never far along the staff:
      // the reader that picks these up again only looks in the space a key
      // signature is actually written in, so a mark found late — a stray
      // blot taken for the first of the row — must not drag the whole
      // signature out of that space and lose it.
      const start = Math.min(
        Math.max(entry.keyFrom ?? clef.end, clef.end),
        staff.x0 + spacing * 8,
      );
      for (let i = 0; i < count; i++) {
        const x = Math.min(
          start + i * spacing * 1.15,
          firstHead - spacing * 0.8,
          staff.x0 + spacing * 13,
        );
        keyAccidentals++;
        glyphs.push({
          ch: fifths > 0 ? ACCIDENTAL.sharp : ACCIDENTAL.flat,
          ...toPdf.glyph(x, staffY(order[i] ?? 0, staff)),
          size: spacing * toPdf.scale * 4,
          advance: spacing * 0.9 * toPdf.scale,
        });
      }
    }
  }

  for (const mark of analysis.noteMarks) {
    glyphs.push({
      ch: ACCIDENTAL[mark.kind],
      ...toPdf.glyph(mark.blob.x0, mark.blob.centerY),
      size: spacing * toPdf.scale * 4,
      advance: (mark.blob.x1 - mark.blob.x0 + 1) * toPdf.scale,
    });
  }

  const rules: Rule[] = bands.map((band) => toPdf.rule(band));
  const strokes: Stroke[] = runs.map((run) => toPdf.stroke(run));
  return {
    ink: { rules, segments: rules.map((rule) => ({ ...rule })), strokes, glyphs },
    report: { ...analysis.report, keyAccidentals },
  };
}

/** The key the whole document reads, by what most of its staves say. */
export function documentKey(pages: readonly PageAnalysis[]): number | null {
  return commonest(pages.flatMap((page) => page.keyCandidates));
}

/** One page on its own, for a document of one page and for tests. */
export function scanPageInk(raster: Raster, options: ScanOptions): ScanResult {
  const analysis = analysePage(raster, options);
  return inkFrom(analysis, documentKey([analysis]));
}

/** Where a clef glyph has to be for the drawn reader to accept it. */
function clefAnchor(kind: 'treble' | 'bass', staff: RasterStaff): number {
  // In raster Y, down is positive, so the G line one space above the bottom
  // line is a spacing *less* than the bottom line's Y.
  return kind === 'treble' ? staff.lines[4]!.y - staff.spacing : staff.lines[0]!.y + staff.spacing;
}

/**
 * How far above or below a staff a notehead may sit and still be one.
 *
 * Five ledger lines, which is as far as piano music goes in practice. The
 * drawn reader can afford to be far more generous, because everything it is
 * handed really is a notehead; here the same generosity turns the page
 * number, the title and the odd letter of "sempre legato" into notes four
 * octaves below the staff, and one of those at the top of a piece is enough
 * to leave the cursor waiting for a key no piano has.
 */
const LEDGER_REACH_HALF_SPACES = 11;

function withinReach(x: number, y: number, staff: RasterStaff): boolean {
  if (x < staff.x0 - staff.spacing || x > staff.x1 + staff.spacing) return false;
  return outsideBy(y, staff) <= LEDGER_REACH_HALF_SPACES;
}

/** How far outside the staff a height is, in half-spaces; 0 while inside. */
function outsideBy(y: number, staff: RasterStaff): number {
  const top = staff.lines[0]!.y;
  const bottom = staff.lines[4]!.y;
  const outside = y < top ? top - y : y > bottom ? y - bottom : 0;
  return outside / (staff.spacing / 2);
}

/** Does a stem stand on this notehead? */
function hasStem(
  head: Head,
  runs: readonly { x: number; y0: number; y1: number }[],
  spacing: number,
): boolean {
  return runs.some(
    (run) =>
      Math.abs(head.x - run.x) < head.width * 0.8 &&
      (Math.abs(head.y - run.y0) < spacing * 1.2 || Math.abs(head.y - run.y1) < spacing * 1.2),
  );
}

function onStaff(x: number, y: number, staff: RasterStaff, spacing: number): boolean {
  if (x < staff.x0 - spacing || x > staff.x1 + spacing) return false;
  return y > staff.lines[0]!.y - spacing * 6 && y < staff.lines[4]!.y + spacing * 6;
}

/**
 * The clef at the start of a staff, and how far along it reaches.
 *
 * The first slice of ink after the brace and the opening barline is the
 * clef, by the engraver's own ordering. Which clef it is comes from where
 * it puts its ink: a treble clef loops well below the bottom line and a bass
 * clef never leaves the top half, so counting ink under the staff separates
 * them outright — no outlines to match and nothing to train.
 *
 * Its right-hand edge is taken as the width a clef is drawn at rather than
 * as the end of the slice, because at this size the clef and the sharp after
 * it are often a pixel or two apart and come back as one slice. A clef's
 * width is not in doubt; where the ink happens to join is.
 */
function clefOn(
  raster: Raster,
  staff: RasterStaff,
  index: number,
  spacing: number,
  until: number,
): { x: number; end: number; kind: 'treble' | 'bass' } {
  const groups = columnGroups(
    raster,
    staff.x0 - spacing,
    Math.min(staff.x0 + spacing * 8, until),
    staff.lines[0]!.y - spacing * 3,
    staff.lines[4]!.y + spacing * 3,
    Math.max(2, Math.round(spacing * 0.18)),
  );
  // The brace and the opening barline come first and are both far taller
  // than the staff and no wider than a line; a clef is neither.
  const clef = groups.find(
    (group) =>
      group.x1 - group.x0 + 1 >= spacing * 1.5 &&
      group.bottom - group.top + 1 >= spacing * 2 &&
      group.area >= spacing * spacing * 0.8,
  );
  const x = clef ? clef.x0 : staff.x0 + spacing * 0.5;
  const below = extentIn(
    raster,
    x,
    x + spacing * 3,
    staff.lines[4]!.y + spacing * 0.6,
    staff.lines[4]!.y + spacing * 3,
  );
  const above = extentIn(raster, x, x + spacing * 3, staff.lines[0]!.y - spacing, staff.lines[4]!.y);
  // Nothing measurable: a piano system is a treble staff over a bass one,
  // and saying so beats leaving a staff with no clef, which would drop
  // every note on it.
  const kind = clefFromInk(below.count, above.count, spacing) ?? (index % 2 === 0 ? 'treble' : 'bass');
  return { x, end: x + spacing * (kind === 'treble' ? 2.9 : 3.1), kind };
}

/**
 * The marks standing between the clef and the first note.
 *
 * Read as slices of ink across the staff rather than as joined-up shapes: a
 * key signature is a row of small marks in their own columns, and the column
 * is the only part of that a scan cannot spoil. A slice as tall as the whole
 * staff is a time signature, not an accidental, and is left where it is.
 */
function keyZone(
  raster: Raster,
  staff: RasterStaff,
  spacing: number,
  from: number,
  firstHead: number,
): { x0: number; top: number; bottom: number }[] {
  const top = staff.lines[0]!.y - spacing * 2;
  const bottom = staff.lines[4]!.y + spacing * 2;
  const groups = columnGroups(
    raster,
    from,
    Math.min(staff.x1, firstHead - spacing * 0.5),
    top,
    bottom,
    Math.max(2, Math.round(spacing * 0.16)),
  );
  return groups.filter((group) => {
    const width = (group.x1 - group.x0 + 1) / spacing;
    const height = (group.bottom - group.top + 1) / spacing;
    return width >= 0.45 && width <= 1.45 && height >= 1.7 && height <= 3.3;
  });
}

/** Where a staff position sits, counting half-spaces up from the bottom line. */
function staffY(halfSpaces: number, staff: RasterStaff): number {
  return staff.lines[4]!.y - (halfSpaces * staff.spacing) / 2;
}

/** The value that turns up most often, ignoring the readings that failed. */
function commonest(values: readonly number[]): number | null {
  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  let best: number | null = null;
  let most = 0;
  for (const [value, count] of tally) {
    if (count > most) {
      most = count;
      best = value;
    }
  }
  return best;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Raster pixels to PDF points: one scale for both directions, and Y flipped,
 * because the page was rendered from the PDF at a known zoom.
 */
function mapper(raster: Raster, options: ScanOptions) {
  const scale = options.pageWidth / raster.width;
  const x = (value: number) => value * scale;
  const y = (value: number) => options.pageHeight - value * scale;
  return {
    scale,
    glyph: (gx: number, gy: number) => ({ x: x(gx), y: y(gy) }),
    rule: (band: LineBand): Rule => ({ y: y(band.y), x0: x(band.x0), x1: x(band.x1) }),
    stroke: (run: { x: number; y0: number; y1: number }): Stroke => ({
      x: x(run.x),
      y0: y(run.y1),
      y1: y(run.y0),
    }),
  };
}
