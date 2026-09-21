/**
 * Reading notes off an engraved PDF.
 *
 * This is arithmetic, not image recognition. A PDF exported from notation
 * software draws its staff lines as vector rules and its noteheads as font
 * glyphs, both at exact coordinates, so a pitch follows from how far above
 * or below a staff line a notehead sits. That makes the result either right
 * or obviously wrong, never approximately right, which is the property that
 * matters when the output is "press this key".
 *
 * What it does not read yet: rhythm, voices, ties, repeats. Every note is
 * returned in reading order with its measure and staff, and that is all.
 */

import {
  joinStrokes,
  readPageInk,
  type Glyph,
  type PageInk,
  type PageLike,
  type PdfOps,
  type Rule,
  type Stroke,
} from './glyphs.ts';
import {
  bottomY,
  clefAt,
  groupStaffLines,
  pitchAt,
  positionError,
  toMidi,
  topY,
  widenStaves,
  type Clef,
  type ClefChange,
  type Staff,
  type WrittenPitch,
} from './staffGeometry.ts';

export interface PdfNote {
  /** 1-based page this note was found on. */
  readonly page: number;
  /** 1-based measure, counted across the whole document. */
  readonly measure: number;
  /** 1 for the upper staff of its system, 2 for the next one down. */
  readonly staff: number;
  /** 0-based system index, counted across the whole document. */
  readonly system: number;
  readonly clef: Clef;
  readonly pitch: WrittenPitch;
  readonly midi: number;
  /** Where the notehead was drawn, in PDF coordinates — for the overlay. */
  readonly x: number;
  readonly y: number;
  /**
   * Horizontal centre of the notehead. `x` is the glyph's origin, its left
   * edge; a marker drawn there sits half a notehead to the left of the note
   * it is marking.
   */
  readonly centerX: number;
  /** How far off a staff position the notehead sat, as a fraction of a half-space. */
  readonly positionError: number;
}

export interface PdfReadDiagnostics {
  readonly fontProfile: string;
  readonly pages: number;
  readonly staves: number;
  readonly systems: number;
  readonly measures: number;
  readonly noteheads: number;
  /** Noteheads found but not assignable to any staff. */
  readonly unplaced: number;
  /** Noteheads on a staff with no clef in force. */
  readonly noClef: number;
  /** Noteheads that did not sit on a staff position — a sign of trouble. */
  readonly offGrid: number;
  readonly warnings: readonly string[];
}

export interface PdfReadResult {
  readonly notes: readonly PdfNote[];
  readonly diagnostics: PdfReadDiagnostics;
  /** Per page, everything the overlay needs to draw itself. */
  readonly pages: readonly PdfPageLayout[];
}

export interface PdfPageLayout {
  readonly page: number;
  readonly staves: readonly Staff[];
  readonly systems: readonly (readonly Staff[])[];
  readonly barlines: readonly number[];
  /**
   * Everything needed to turn a point on a staff into a note — what a click
   * on the page has to do when you add a note the reader missed.
   */
  readonly staffInfo: readonly StaffInfo[];
}

export interface StaffInfo {
  readonly staff: Staff;
  /** 0-based system index across the document. */
  readonly system: number;
  /** 1 for the upper staff of its system. */
  readonly staffNumber: number;
  readonly clefs: readonly ClefChange[];
  /** Alteration each letter carries under the key signature. */
  readonly key: Readonly<Partial<Record<WrittenPitch['step'], -1 | 0 | 1>>>;
  /** Sharps positive, flats negative — for spelling a changed note. */
  readonly keyFifths: number;
  readonly barlines: readonly number[];
  /** Measures before this system starts. */
  readonly measureBase: number;
}

/**
 * Where a music font puts its glyphs.
 *
 * SMuFL is the standard, used by MuseScore, Dorico and anything else
 * modern. Sibelius's Opus font predates it and puts the same glyphs on
 * ordinary Latin characters, so the two have to be told apart — and by
 * looking at what is on the page, not at the font's name, which producers
 * spell however they like.
 */
export interface FontProfile {
  readonly name: string;
  readonly noteheads: ReadonlySet<string>;
  readonly clefs: Readonly<Record<string, Clef>>;
  readonly accidentals: Readonly<Record<string, -1 | 0 | 1>>;
}

export const FONT_PROFILES: readonly FontProfile[] = [
  {
    name: 'SMuFL',
    // Black, half and whole noteheads.
    noteheads: new Set(['', '', '']),
    clefs: { '': 'treble', '': 'bass' },
    accidentals: { '': -1, '': 0, '': 1 },
  },
  {
    name: 'Opus',
    // Verified against the glyph stream, not guessed: U+0153 is the filled
    // notehead and U+02D9 the hollow one (half and whole notes). The
    // tempting U+2122, which occurs about as often, is the augmentation
    // dot — 109 of its 110 occurrences sit in a staff space and only one
    // on a line, which is exactly what a dot does and no notehead does.
    noteheads: new Set(['œ', '˙']),
    clefs: { '&': 'treble', '?': 'bass' },
    accidentals: { b: -1, n: 0, '#': 1 },
  },
];

export function chooseFontProfile(glyphs: readonly Glyph[]): {
  profile: FontProfile;
  noteheads: number;
} {
  const scored = FONT_PROFILES.map((profile) => ({
    profile,
    noteheads: glyphs.filter((g) => profile.noteheads.has(g.ch)).length,
  })).sort((a, b) => b.noteheads - a.noteheads);
  return scored[0]!;
}

/** Clefs along a staff, each with the x it takes effect from. */
export function clefChangesOn(
  staff: Staff,
  glyphs: readonly Glyph[],
  profile: FontProfile,
): ClefChange[] {
  // A clef is anchored on the line it names: treble on the G line, which is
  // one space above the bottom; bass on the F line, one space below the top.
  const anchor: Record<Clef, number> = {
    treble: bottomY(staff) + staff.spacing,
    bass: topY(staff) - staff.spacing,
  };
  const changes: ClefChange[] = [];
  for (const glyph of glyphs) {
    const clef = profile.clefs[glyph.ch];
    if (!clef) continue;
    if (glyph.x < staff.x0 - 10 || glyph.x > staff.x1 + 10) continue;
    if (Math.abs(glyph.y - anchor[clef]) < staff.spacing * 0.6) {
      changes.push({ x: glyph.x, clef });
    }
  }
  return changes;
}

/**
 * The key signature in force on a staff: the accidentals standing between
 * the clef and the first note.
 */
export function keySignatureOn(
  staff: Staff,
  glyphs: readonly Glyph[],
  profile: FontProfile,
  clefs: readonly ClefChange[],
): Map<WrittenPitch['step'], -1 | 0 | 1> {
  const middle = (topY(staff) + bottomY(staff)) / 2;
  const heads = glyphs.filter(
    (g) =>
      profile.noteheads.has(g.ch) &&
      g.x >= staff.x0 - 2 &&
      g.x <= staff.x1 + 2 &&
      Math.abs(g.y - middle) < staff.spacing * 8,
  );
  const firstHeadX = Math.min(...heads.map((h) => h.x), Infinity);
  const clef = clefAt(clefs, staff.x0 + 1);

  const alters = new Map<WrittenPitch['step'], -1 | 0 | 1>();
  if (!clef) return alters;
  for (const glyph of glyphs) {
    const alter = profile.accidentals[glyph.ch];
    if (alter === undefined) continue;
    if (glyph.x < staff.x0) continue;
    if (glyph.x > Math.min(firstHeadX - 2, staff.x0 + 70)) continue;
    if (Math.abs(glyph.y - middle) > staff.spacing * 4) continue;
    alters.set(pitchAt(glyph.y, staff, clef).step, alter);
  }
  return alters;
}

/**
 * Barlines, and the systems they define.
 *
 * Systems are taken from the barlines rather than from the gaps between
 * staves, because on a vertically justified page those gaps do not
 * separate: one score here has 57.6 points inside a system and 57.2
 * between, so no threshold can tell them apart. A barline is what the
 * engraver actually drew around a system, and a stroke that runs the full
 * height of one is a barline — a note stem covers a single staff of a
 * grand staff and fails that test without needing a height guess.
 */
export function findSystems(
  staves: readonly Staff[],
  strokes: readonly Stroke[],
): { systems: Staff[][]; barlinesOf: Map<Staff, number[]> } {
  const runs = joinStrokes(strokes);
  const tolerance = staves.length ? staves[0]!.spacing * 0.6 : 1;
  const covers = runs.map((run) =>
    staves.filter((s) => run.y1 >= topY(s) - tolerance && run.y0 <= bottomY(s) + tolerance),
  );

  const parent = new Map<Staff, Staff>(staves.map((s) => [s, s]));
  const find = (s: Staff): Staff => {
    let node = s;
    while (parent.get(node) !== node) node = parent.get(node)!;
    return node;
  };
  for (const group of covers) {
    for (let i = 1; i < group.length; i++) parent.set(find(group[i - 1]!), find(group[i]!));
  }

  const size = new Map<Staff, number>();
  for (const s of staves) size.set(find(s), (size.get(find(s)) ?? 0) + 1);

  const barlinesOf = new Map<Staff, number[]>(staves.map((s) => [s, []]));
  for (const [i, run] of runs.entries()) {
    const group = covers[i]!;
    if (!group.length) continue;
    const root = find(group[0]!);
    if (group.length < size.get(root)!) continue;
    for (const s of staves) if (find(s) === root) barlinesOf.get(s)!.push(run.x);
  }
  for (const [staff, xs] of barlinesOf) {
    xs.sort((a, b) => a - b);
    // A double barline — thin plus thick, or a repeat — is two strokes a
    // couple of points apart and divides one measure, not two.
    const merged: number[] = [];
    for (const x of xs) {
      if (!merged.length || x - merged[merged.length - 1]! > staff.spacing) merged.push(x);
    }
    barlinesOf.set(staff, merged);
  }

  const systems = [...new Set(staves.map(find))]
    .map((root) => staves.filter((s) => find(s) === root).sort((a, b) => topY(b) - topY(a)))
    .sort((a, b) => topY(b[0]!) - topY(a[0]!));

  return { systems, barlinesOf };
}

/**
 * Which staff a notehead belongs to.
 *
 * Nearest is not the same as right. A note on ledger lines high above the
 * lower system of a page can sit closer to the staff above it than to its
 * own — this score has one that does, and reading it off the wrong staff
 * put it two and a half octaves out.
 *
 * What settles it is the grid. A notehead lands exactly on a line or a
 * space of the staff it belongs to, and between the lines of any other,
 * because that is what the engraver drew. So an on-grid staff beats an
 * off-grid one however far away it is, and distance only breaks ties
 * between staves that are both on-grid.
 */
export function chooseStaff(x: number, y: number, staves: readonly Staff[]): Staff | null {
  let best: Staff | null = null;
  let bestSteps = Infinity;
  let bestOnGrid = false;

  for (const staff of staves) {
    if (x < staff.x0 - 2 || x > staff.x1 + 2) continue;
    const steps = Math.abs((y - (topY(staff) + bottomY(staff)) / 2) / (staff.spacing / 2));
    // Twenty-four half-spaces is about two octaves clear of the staff —
    // further than any ledger line goes.
    if (steps > 24) continue;

    const onGrid = positionError(y, staff) <= 0.25;
    const better = onGrid === bestOnGrid ? steps < bestSteps : onGrid;
    if (better) {
      bestSteps = steps;
      bestOnGrid = onGrid;
      best = staff;
    }
  }
  return best;
}

/**
 * The alteration a notehead carries: an accidental drawn beside it, else
 * one set earlier in the same measure, else the key signature.
 */
function alterFor(
  head: Glyph,
  staff: Staff,
  glyphs: readonly Glyph[],
  profile: FontProfile,
  measureState: Map<string, -1 | 0 | 1>,
  key: ReadonlyMap<WrittenPitch['step'], -1 | 0 | 1>,
  pitch: WrittenPitch,
): -1 | 0 | 1 {
  const name = `${pitch.step}${pitch.octave}`;
  for (const glyph of glyphs) {
    const alter = profile.accidentals[glyph.ch];
    if (alter === undefined) continue;
    if (Math.abs(glyph.y - head.y) > staff.spacing * 0.4) continue;
    const dx = head.x - glyph.x;
    if (dx > 0.5 && dx < staff.spacing * 3.2) {
      // An accidental holds for the rest of the measure, not just its note.
      measureState.set(name, alter);
      return alter;
    }
  }
  return measureState.get(name) ?? key.get(pitch.step) ?? 0;
}

export interface ReadPdfOptions {
  readonly OPS: PdfOps;
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PageLike>;
}

export async function readPdfNotes(doc: ReadPdfOptions): Promise<PdfReadResult> {
  const notes: PdfNote[] = [];
  const layouts: PdfPageLayout[] = [];
  const warnings: string[] = [];
  let profile = FONT_PROFILES[0]!;
  let totalStaves = 0;
  let totalSystems = 0;
  let totalHeads = 0;
  let unplaced = 0;
  let noClef = 0;
  let offGrid = 0;
  let measureBase = 0;

  for (let page = 1; page <= doc.numPages; page++) {
    const ink: PageInk = await readPageInk(await doc.getPage(page), doc.OPS);
    if (page === 1) {
      const chosen = chooseFontProfile(ink.glyphs);
      profile = chosen.profile;
      if (chosen.noteheads === 0) {
        warnings.push(
          'No noteheads recognised. This PDF is probably a scan, or uses a music font ' +
            'that is neither SMuFL nor Sibelius Opus.',
        );
      }
    }

    const staves = widenStaves(groupStaffLines(ink.rules as Rule[]), ink.segments);
    totalStaves += staves.length;
    const { systems, barlinesOf } = findSystems(staves, ink.strokes);
    const systemBase = totalSystems;
    totalSystems += systems.length;

    const clefsOf = new Map(staves.map((s) => [s, clefChangesOn(s, ink.glyphs, profile)]));
    const keyOf = new Map(
      staves.map((s) => [s, keySignatureOn(s, ink.glyphs, profile, clefsOf.get(s)!)]),
    );

    const staffNumber = new Map<Staff, number>();
    const systemIndexOf = new Map<Staff, number>();
    const measureBaseOf = new Map<Staff, number>();
    for (const [index, system] of systems.entries()) {
      system.forEach((s, i) => {
        staffNumber.set(s, i + 1);
        systemIndexOf.set(s, systemBase + index);
      });
      for (const s of system) measureBaseOf.set(s, measureBase);
      // The leftmost barline opens the system rather than dividing it, so a
      // system holds one measure fewer than it has barlines.
      measureBase += Math.max(0, barlinesOf.get(system[0]!)!.length - 1);
    }

    // Assign every notehead to a staff once, page-wide. Doing it per system
    // counts a notehead again for each system it is tested against.
    const heads = ink.glyphs.filter((g) => profile.noteheads.has(g.ch));
    totalHeads += heads.length;
    const perStaff = new Map<Staff, Glyph[]>(staves.map((s) => [s, []]));
    for (const head of heads) {
      const best = chooseStaff(head.x, head.y, staves);
      if (!best) {
        unplaced++;
        continue;
      }
      perStaff.get(best)!.push(head);
    }

    for (const [staff, list] of perStaff) {
      list.sort((a, b) => a.x - b.x);
      const bars = barlinesOf.get(staff)!;
      const clefs = clefsOf.get(staff)!;
      const key = keyOf.get(staff)!;
      let measure = -1;
      let state = new Map<string, -1 | 0 | 1>();

      for (const head of list) {
        const local = bars.filter((b) => b <= head.x).length;
        if (local !== measure) {
          measure = local;
          // Accidentals last to the end of the measure and no further.
          state = new Map();
        }
        const clef = clefAt(clefs, head.x);
        if (!clef) {
          noClef++;
          continue;
        }
        const error = positionError(head.y, staff);
        if (error > 0.25) offGrid++;
        const written = pitchAt(head.y, staff, clef);
        const alter = alterFor(head, staff, ink.glyphs, profile, state, key, written);
        const pitch: WrittenPitch = { ...written, alter };
        notes.push({
          page,
          measure: measureBaseOf.get(staff)! + measure,
          staff: staffNumber.get(staff) ?? 1,
          system: systemIndexOf.get(staff) ?? 0,
          clef,
          pitch,
          midi: toMidi(pitch),
          x: head.x,
          y: head.y,
          centerX: head.x + head.advance / 2,
          positionError: error,
        });
      }
    }

    layouts.push({
      page,
      staves,
      systems,
      barlines: [...new Set(systems.flatMap((s) => barlinesOf.get(s[0]!)!))].sort((a, b) => a - b),
      staffInfo: staves.map((staff) => {
        const key = keyOf.get(staff)!;
        let fifths = 0;
        for (const alter of key.values()) fifths += alter;
        return {
          staff,
          system: systemIndexOf.get(staff) ?? 0,
          staffNumber: staffNumber.get(staff) ?? 1,
          clefs: clefsOf.get(staff)!,
          key: Object.fromEntries(key),
          keyFifths: fifths,
          barlines: barlinesOf.get(staff)!,
          measureBase: measureBaseOf.get(staff) ?? 0,
        };
      }),
    });
  }

  notes.sort((a, b) => a.system - b.system || a.x - b.x || a.staff - b.staff || b.y - a.y);

  if (unplaced) warnings.push(`${unplaced} notehead(s) could not be placed on a staff.`);
  if (noClef) warnings.push(`${noClef} notehead(s) sat on a staff with no clef.`);
  if (offGrid) warnings.push(`${offGrid} notehead(s) did not sit on a staff position.`);

  return {
    notes,
    pages: layouts,
    diagnostics: {
      fontProfile: profile.name,
      pages: doc.numPages,
      staves: totalStaves,
      systems: totalSystems,
      measures: measureBase,
      noteheads: totalHeads,
      unplaced,
      noClef,
      offGrid,
      warnings,
    },
  };
}
