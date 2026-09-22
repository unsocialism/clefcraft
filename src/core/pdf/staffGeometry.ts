/**
 * Turning positions on a page into pitches.
 *
 * All of this is arithmetic on coordinates — no image recognition anywhere.
 * A PDF exported from notation software draws its staff lines as vector rules
 * and its noteheads as font glyphs, both with exact positions, so a note's
 * pitch follows from how far above or below a staff line it sits.
 *
 * PDF coordinates put Y increasing *upward*, which is the opposite of screen
 * coordinates and the opposite of how staves are usually described. Every
 * function here works in PDF space and says so.
 */

export type Clef = 'treble' | 'bass';

/** Five line positions, in PDF Y, ordered top line first (largest Y first). */
export interface Staff {
  readonly lineYs: readonly number[];
  /** Distance between adjacent lines. */
  readonly spacing: number;
  /** Leftmost and rightmost extent of the rules, for assigning notes. */
  readonly x0: number;
  readonly x1: number;
}

export interface StaffSystem {
  readonly staves: readonly Staff[];
}

/** A pitch as written: letter, accidental, octave. */
export interface WrittenPitch {
  readonly step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  readonly alter: -1 | 0 | 1;
  readonly octave: number;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Absolute diatonic index: C0 is 0, D0 is 1, C1 is 7. Counting scale degrees
 * rather than semitones is what makes staff geometry linear — every step up
 * the ladder is half a staff space, regardless of where the tones and
 * semitones fall.
 */
export function diatonicIndex(letter: WrittenPitch['step'], octave: number): number {
  return octave * 7 + LETTERS.indexOf(letter);
}

export function fromDiatonicIndex(index: number): { step: WrittenPitch['step']; octave: number } {
  const octave = Math.floor(index / 7);
  const step = LETTERS[((index % 7) + 7) % 7];
  return { step: step ?? 'C', octave };
}

/** The diatonic index sitting on a clef's bottom staff line. */
export function bottomLineIndex(clef: Clef): number {
  // Treble: bottom line is E4. Bass: bottom line is G2.
  return clef === 'treble' ? diatonicIndex('E', 4) : diatonicIndex('G', 2);
}

/**
 * Group sorted line positions into five-line staves.
 *
 * Lines belong to the same staff while their spacing stays close to the
 * running average; a larger jump starts a new staff. Anything that does not
 * come out as exactly five lines is rejected rather than guessed at — a
 * four-line "staff" would silently shift every pitch on it.
 */
export function groupStaffLines(
  rules: readonly { y: number; x0: number; x1: number }[],
  tolerance = 0.1,
): Staff[] {
  if (rules.length < 5) return [];

  // Top of page first: PDF Y decreases downward.
  const sorted = [...rules].sort((a, b) => b.y - a.y);

  // The staff line spacing. Not simply the commonest small gap: on a page
  // full of beams, which MuseScore draws as bundles of thin horizontal
  // rules a point or two apart, the commonest gap is a beam's, and taking
  // it finds no staff at all. Each candidate gap is tried instead, and the
  // one that assembles the most staves wins — on a tie the wider, since
  // beam fragments are always tighter than staff lines.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1]!.y - sorted[i]!.y);
  const candidates = [...new Set(gaps.filter((g) => g > 0.2).map((g) => Math.round(g * 20) / 20))];
  let best: Staff[] = [];
  let bestSpacing = 0;
  for (const spacing of candidates) {
    const found = scanForStaves(sorted, spacing, tolerance);
    if (found.length > best.length || (found.length === best.length && found.length > 0 && spacing > bestSpacing)) {
      best = found;
      bestSpacing = spacing;
    }
  }
  return best;
}

function scanForStaves(
  sorted: readonly { y: number; x0: number; x1: number }[],
  spacing: number,
  tolerance: number,
): Staff[] {
  // Scan for runs of exactly five evenly spaced rules. A rule that does not
  // start such a run is skipped rather than absorbed: pages carry long
  // horizontal rules that are not staff lines — 8va brackets, dashes,
  // hairpins — and letting one into a group shifts every staff after it,
  // which silently moves every pitch on them.
  //
  // A rule can also sit *between* two lines of a staff: a flat beam across
  // a run of repeated notes is a long horizontal bar half-way between two
  // staff lines. It is stepped over, not counted, so the staff is still
  // found. (MuseScore draws a flat beam as exactly such a rule; before
  // this, every staff with one lost its notes.)
  // Five evenly spaced rules starting at `from`, stepping over intruders,
  // or null if there are none.
  const fiveFrom = (from: number): number[] | null => {
    const picked = [from];
    let j = from + 1;
    while (picked.length < 5 && j < sorted.length) {
      const gap = sorted[picked[picked.length - 1]!]!.y - sorted[j]!.y;
      if (Math.abs(gap - spacing) <= spacing * tolerance) {
        picked.push(j);
      } else if (gap > spacing * (1 + tolerance)) {
        break; // past where the next line should be: no staff starts here
      }
      // Otherwise it is closer than a line would be — an intruder; step over.
      j += 1;
    }
    return picked.length === 5 ? picked : null;
  };
  const shortest = (picked: readonly number[]) =>
    Math.min(...picked.map((k) => sorted[k]!.x1 - sorted[k]!.x0));

  const staves: Staff[] = [];
  let i = 0;
  while (i + 4 < sorted.length) {
    // Beams above a staff can be evenly spaced with it — they are drawn at
    // the same pitch as the staff lines — so several runs of five can start
    // within a space or two of each other and only one of them is the
    // staff. Staff lines run the width of the system and beams are short,
    // so the run whose shortest rule is longest wins.
    let picked: number[] | null = null;
    for (let k = i; k < sorted.length && sorted[i]!.y - sorted[k]!.y <= spacing * 2.5; k++) {
      const run = fiveFrom(k);
      if (run && (!picked || shortest(run) > shortest(picked))) picked = run;
    }
    if (!picked) {
      i += 1;
      continue;
    }
    const group = picked.map((k) => sorted[k]!);
    staves.push({
      lineYs: group.map((r) => r.y),
      spacing: (group[0]!.y - group[4]!.y) / 4,
      x0: Math.min(...group.map((r) => r.x0)),
      x1: Math.max(...group.map((r) => r.x1)),
    });
    i = picked[4]! + 1;
  }

  return staves;
}

/**
 * Extend each staff's horizontal extent with short rules that continue it.
 *
 * A staff line is not one segment. Notation software draws it in pieces, and
 * the last piece of a system can be short enough to fall under any sensible
 * "this is a staff line" length threshold. The staff is still found — the
 * long pieces see to that — but its right edge stops early, and every note
 * in the final measure then sits outside the staff and is dropped.
 *
 * A candidate must lie on one of the five line positions and touch the
 * range already known, which is what keeps ledger lines out: a ledger line
 * is by definition off the five lines.
 */
export function widenStaves(
  staves: readonly Staff[],
  rules: readonly { y: number; x0: number; x1: number }[],
  tolerance = 0.3,
): Staff[] {
  return staves.map((staff) => {
    let { x0, x1 } = staff;
    // Repeat until nothing more joins on: pieces can chain end to end.
    for (let grew = true; grew; ) {
      grew = false;
      for (const rule of rules) {
        if (!staff.lineYs.some((y) => Math.abs(y - rule.y) < tolerance)) continue;
        if (rule.x1 < x0 - 2 || rule.x0 > x1 + 2) continue;
        if (rule.x0 < x0 - 0.001 || rule.x1 > x1 + 0.001) {
          x0 = Math.min(x0, rule.x0);
          x1 = Math.max(x1, rule.x1);
          grew = true;
        }
      }
    }
    return { ...staff, x0, x1 };
  });
}

/**
 * Pair staves into grand-staff systems.
 *
 * The two staves of a piano system sit closer together than consecutive
 * systems do, so the gaps fall into two clusters and the split point is the
 * midpoint between them. With only one cluster every staff stands alone,
 * which is the right answer for single-staff music.
 */
export function pairIntoSystems(staves: readonly Staff[]): StaffSystem[] {
  if (staves.length < 2) return staves.map((staff) => ({ staves: [staff] }));

  const gaps: number[] = [];
  for (let i = 1; i < staves.length; i++) {
    gaps.push(bottomY(staves[i - 1]!) - topY(staves[i]!));
  }

  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  // A single cluster means no pairing to do.
  if (max - min < min * 0.2) {
    return staves.map((staff) => ({ staves: [staff] }));
  }
  const split = (min + max) / 2;

  const systems: StaffSystem[] = [];
  let group: Staff[] = [staves[0]!];
  for (let i = 1; i < staves.length; i++) {
    if (gaps[i - 1]! <= split) {
      group.push(staves[i]!);
    } else {
      systems.push({ staves: group });
      group = [staves[i]!];
    }
  }
  systems.push({ staves: group });
  return systems;
}

export function topY(staff: Staff): number {
  return staff.lineYs[0]!;
}

export function bottomY(staff: Staff): number {
  return staff.lineYs[staff.lineYs.length - 1]!;
}

/**
 * How many half-spaces a Y position sits above the staff's bottom line.
 * Rounded to the nearest position, because that is what the engraver drew.
 */
export function stepsAboveBottomLine(y: number, staff: Staff): number {
  return Math.round((y - bottomY(staff)) / (staff.spacing / 2));
}

/**
 * How far the rounded position missed by, as a fraction of a half-space.
 * A clean engraving sits within a few percent; anything near 0.5 means the
 * note was not on a staff position at all and should not be trusted.
 */
export function positionError(y: number, staff: Staff): number {
  const half = staff.spacing / 2;
  const exact = (y - bottomY(staff)) / half;
  return Math.abs(exact - Math.round(exact));
}

/** The pitch written at a Y position on a staff, before any accidental. */
export function pitchAt(y: number, staff: Staff, clef: Clef): WrittenPitch {
  const index = bottomLineIndex(clef) + stepsAboveBottomLine(y, staff);
  const { step, octave } = fromDiatonicIndex(index);
  return { step, alter: 0, octave };
}

/** MIDI number for a written pitch. */
export function toMidi(pitch: WrittenPitch): number {
  const semitone = SEMITONES[LETTERS.indexOf(pitch.step)] ?? 0;
  return 12 * (pitch.octave + 1) + semitone + pitch.alter;
}

/** A clef and the horizontal position from which it applies. */
export interface ClefChange {
  readonly x: number;
  readonly clef: Clef;
}

/**
 * The clef in force at a horizontal position.
 *
 * A staff does not have "a clef" — it has a sequence of them. Piano writing
 * changes clef mid-staff constantly so the hand can cross registers without
 * a thicket of ledger lines, and this score does it often. Applying only the
 * clef at the start of the staff misreads every note after the change by
 * twelve scale degrees, close to two octaves, which is severe enough to look
 * like a completely different piece.
 *
 * Returns the last clef starting at or before `x`, or the earliest clef on
 * the staff when `x` precedes all of them.
 */
export function clefAt(changes: readonly ClefChange[], x: number): Clef | null {
  if (changes.length === 0) return null;
  const sorted = [...changes].sort((a, b) => a.x - b.x);
  let current = sorted[0]!.clef;
  for (const change of sorted) {
    if (change.x > x) break;
    current = change.clef;
  }
  return current;
}
