/**
 * Reading exercises, generated.
 *
 * Six levels, each adding exactly one thing to the one before, so a level
 * is never hard for two reasons at once:
 *
 *   1. Treble clef, C4–G4 — the five-finger position.
 *   2. The whole treble staff, bottom line to top line.
 *   3. The whole bass staff, on its own.
 *   4. Both staves, the melody passing between the hands.
 *   5. Ledger lines: two above and two below each staff.
 *   6. Key signatures, and sharps, flats and naturals written in the bar.
 *   7. Two notes at once in one hand: thirds, fourths, fifths, sixths,
 *      octaves. Any order, no hurry.
 *   8. The same, but both notes pressed together.
 *   9. Key signatures up to four sharps or flats.
 *  10. Triads in one hand, root position, pressed together — back to keys
 *      of up to two sharps or flats, so the new shape is the only new thing.
 *  11. Triads in first and second inversion as well.
 *  12. Both hands at once: a melody note over a bass note on every beat.
 *  13. A triad in the right hand over a bass note, in keys up to four
 *      sharps or flats.
 *
 * Notes move mostly by step, with the occasional small leap, the way a
 * melody does. That is deliberate: reading real music is reading intervals
 * — "up a third from here" — far more than naming isolated notes, and a
 * purely random sequence would train the wrong habit.
 *
 * Everything here is pure and seeded. The same seed gives the same
 * exercise, which is what makes the generator testable at all.
 */

import { keyAlterations, keySignatureByFifths, STEPS, type Step } from '../music/keySignature.ts';
import type { Score, ScoreEvent } from '../score/types.ts';

export type TrainingClef = 'treble' | 'bass';
export type Alter = -1 | 0 | 1;
export type WrittenAccidental = '#' | 'b' | 'n';

/** Inclusive range on the diatonic ladder: C0 = 0, D0 = 1, C1 = 7. */
type Range = readonly [low: number, high: number];

export interface Level {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** Which staves notes may appear on. */
  readonly clefs: readonly TrainingClef[];
  readonly range: Readonly<Partial<Record<TrainingClef, Range>>>;
  /** Key signatures to choose from, as fifths (sharps positive, flats negative). */
  readonly keys: readonly number[];
  /** Chance that a note is altered away from the key signature. */
  readonly chromaticChance: number;
  /** Two notes at a time, in one hand. */
  readonly intervals?: boolean;
  /**
   * The notes of an interval must be pressed together, within the chord
   * window. Otherwise they may come in any order, as slowly as you like.
   */
  readonly together?: boolean;
  /** Three notes at a time in one hand: root position only, or any inversion. */
  readonly triads?: 'root' | 'all';
  /**
   * Both hands on every beat: the right hand plays a note (or, with
   * `triads`, a chord) and the left hand a single bass note under it.
   */
  readonly bothHands?: boolean;
}

const d = (step: Step, octave: number): number => octave * 7 + STEPS.indexOf(step);

// The staves themselves: treble E4–F5, bass G2–A3.
const TREBLE_STAFF: Range = [d('E', 4), d('F', 5)];
const BASS_STAFF: Range = [d('G', 2), d('A', 3)];
// Two ledger lines beyond each end: treble A3–C6, bass C2–E4.
const TREBLE_LEDGERS: Range = [d('A', 3), d('C', 6)];
const BASS_LEDGERS: Range = [d('C', 2), d('E', 4)];
// Both hands at once: the hands meet at middle C but never cross, which
// would put the melody under the bass.
const RIGHT_HAND: Range = [d('C', 4), d('C', 6)];
const LEFT_HAND: Range = [d('C', 2), d('B', 3)];

export const LEVELS: readonly Level[] = [
  {
    id: 1,
    name: 'Five-finger position',
    description: 'Treble clef, C to G around middle C.',
    clefs: ['treble'],
    range: { treble: [d('C', 4), d('G', 4)] },
    keys: [0],
    chromaticChance: 0,
  },
  {
    id: 2,
    name: 'Treble staff',
    description: 'Every line and space of the treble staff.',
    clefs: ['treble'],
    range: { treble: TREBLE_STAFF },
    keys: [0],
    chromaticChance: 0,
  },
  {
    id: 3,
    name: 'Bass staff',
    description: 'Every line and space of the bass staff.',
    clefs: ['bass'],
    range: { bass: BASS_STAFF },
    keys: [0],
    chromaticChance: 0,
  },
  {
    id: 4,
    name: 'Both staves',
    description: 'The melody passes between the hands, bar by bar.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_STAFF, bass: BASS_STAFF },
    keys: [0],
    chromaticChance: 0,
  },
  {
    id: 5,
    name: 'Ledger lines',
    description: 'Up to two ledger lines above and below each staff.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [0],
    chromaticChance: 0,
  },
  {
    id: 6,
    name: 'Sharps and flats',
    description: 'Key signatures up to two sharps or flats, plus accidentals in the bar.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [-2, -1, 0, 1, 2],
    chromaticChance: 0.12,
  },
  {
    id: 7,
    name: 'Intervals',
    description: 'Two notes at once in one hand. Play them in any order.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [-2, -1, 0, 1, 2],
    // Lower than level 6: with two notes a beat, the same chance per note
    // would put an accidental on almost every other interval.
    chromaticChance: 0.06,
    intervals: true,
  },
  {
    id: 8,
    name: 'Intervals together',
    description: 'Two notes at once in one hand, pressed together.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [-2, -1, 0, 1, 2],
    chromaticChance: 0.06,
    intervals: true,
    together: true,
  },
  {
    id: 9,
    name: 'More keys',
    description: 'Intervals, pressed together, in keys up to four sharps or flats.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
    chromaticChance: 0.06,
    intervals: true,
    together: true,
  },
  // The chord levels leave accidentals out: an altered note in a triad
  // changes the chord, which is a harmony lesson rather than a reading one.
  {
    id: 10,
    name: 'Triads',
    description: 'Three-note chords in one hand, root position, pressed together.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [-2, -1, 0, 1, 2],
    chromaticChance: 0,
    together: true,
    triads: 'root',
  },
  {
    id: 11,
    name: 'Inversions',
    description: 'Triads in root position and both inversions, pressed together.',
    clefs: ['treble', 'bass'],
    range: { treble: TREBLE_LEDGERS, bass: BASS_LEDGERS },
    keys: [-2, -1, 0, 1, 2],
    chromaticChance: 0,
    together: true,
    triads: 'all',
  },
  {
    id: 12,
    name: 'Both hands',
    description: 'A note in each hand on every beat, pressed together.',
    clefs: ['treble', 'bass'],
    range: { treble: RIGHT_HAND, bass: LEFT_HAND },
    keys: [-2, -1, 0, 1, 2],
    chromaticChance: 0,
    together: true,
    bothHands: true,
  },
  {
    id: 13,
    name: 'Both hands, chords',
    description: 'A triad in the right hand over a bass note, in keys up to four sharps or flats.',
    clefs: ['treble', 'bass'],
    range: { treble: RIGHT_HAND, bass: LEFT_HAND },
    keys: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
    chromaticChance: 0,
    together: true,
    bothHands: true,
    triads: 'all',
  },
];

/** More than one note on a beat, at this level. */
export function isChordLevel(level: Level): boolean {
  return Boolean(level.intervals || level.triads || level.bothHands);
}

export function levelById(id: number): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0]!;
}

export interface GeneratedNote {
  /** 1 = treble / right hand, 2 = bass / left hand. */
  readonly staff: 1 | 2;
  readonly clef: TrainingClef;
  readonly step: Step;
  readonly octave: number;
  /** The pitch as sounded: key signature and any accidental applied. */
  readonly alter: Alter;
  readonly midi: number;
  /**
   * The accidental to engrave on this note, or null when the key
   * signature — or an accidental earlier in the bar — already says it.
   */
  readonly accidental: WrittenAccidental | null;
  /** 1-based. */
  readonly measure: number;
  /** 0-based beat within the measure. */
  readonly beat: number;
  /**
   * Which event of the exercise this note belongs to, 0-based. Notes of an
   * interval share one; on the single-note levels it is the note's index.
   */
  readonly event: number;
}

export interface Exercise {
  readonly level: number;
  /** How many things to play: beats, not notes, once there are intervals. */
  readonly events: number;
  readonly fifths: number;
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly notes: readonly GeneratedNote[];
  readonly seed: number;
}

/** Small, fast, seedable. Good enough for shuffling practice notes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEMITONE: Readonly<Record<Step, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function midiOf(step: Step, octave: number, alter: number): number {
  return 12 * (octave + 1) + SEMITONE[step] + alter;
}

/**
 * How far the next note moves, in scale steps. Mostly neighbours; thirds
 * fairly often; fourths and fifths now and then; the same note again
 * rarely, since a repeated note teaches nothing about reading.
 */
const INTERVALS: readonly (readonly [size: number, weight: number])[] = [
  [0, 0.04],
  [1, 0.52],
  [2, 0.26],
  [3, 0.11],
  [4, 0.07],
];

function pickInterval(random: () => number): number {
  let roll = random();
  for (const [size, weight] of INTERVALS) {
    if (roll < weight) return size;
    roll -= weight;
  }
  return 1;
}

/** One step of the walk, turned back at the edge of the range. */
function nextPosition(current: number, range: Range, random: () => number): number {
  const size = pickInterval(random);
  const direction = random() < 0.5 ? -1 : 1;
  let next = current + direction * size;
  // Reflect rather than clamp: clamping piles notes up on the boundary,
  // which makes the top and bottom notes the most common ones.
  if (next > range[1]) next = current - size;
  if (next < range[0]) next = current + size;
  return Math.min(range[1], Math.max(range[0], next));
}

/**
 * Interval sizes in scale steps: a third is 2, an octave 7. Thirds and
 * sixths most — they are what two-note writing mostly is — then fifths,
 * octaves and fourths. Seconds and sevenths are left out: their noteheads
 * sit side by side or look like a misprint, a reading problem of their own.
 */
const INTERVAL_SIZES: readonly (readonly [size: number, weight: number])[] = [
  [2, 0.35],
  [5, 0.2],
  [4, 0.2],
  [7, 0.15],
  [3, 0.1],
];

/**
 * Triad shapes as scale steps up from the lowest note: root position is
 * two stacked thirds; first inversion puts the root on top (a third, then a
 * fourth); second inversion puts the fifth at the bottom (a fourth, then a
 * third).
 */
const TRIAD_SHAPES: readonly (readonly [number, number, number])[] = [
  [0, 2, 4],
  [0, 2, 5],
  [0, 3, 5],
];

function pickIntervalSize(random: () => number, fits: (size: number) => boolean): number {
  const options = INTERVAL_SIZES.filter(([size]) => fits(size));
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [size, weight] of options) {
    if (roll < weight) return size;
    roll -= weight;
  }
  return options[options.length - 1]?.[0] ?? 2;
}

/**
 * Which accidentals to write, given the sounded pitches.
 *
 * The engraving rule: an accidental lasts to the end of its bar, applies to
 * that one staff position only, and is otherwise the key signature. So a
 * note needs an accidental exactly when what it sounds differs from what
 * the reader would assume at that point — and a natural sign is how a note
 * cancels a sharp or flat the key or the bar put there.
 *
 * Accidentals are tracked per staff, as they are on paper: an F♯ in the
 * right hand says nothing about an F in the left.
 */
export function accidentalsToWrite(
  notes: readonly { staff: number; step: Step; octave: number; alter: Alter; measure: number }[],
  fifths: number,
): (WrittenAccidental | null)[] {
  const key = keyAlterations(fifths);
  const inBar = new Map<string, Alter>();
  let measure = -1;
  return notes.map((note) => {
    if (note.measure !== measure) {
      measure = note.measure;
      inBar.clear();
    }
    const slot = `${note.staff}:${note.step}${note.octave}`;
    const assumed = inBar.get(slot) ?? key[note.step];
    inBar.set(slot, note.alter);
    if (note.alter === assumed) return null;
    return note.alter === 1 ? '#' : note.alter === -1 ? 'b' : 'n';
  });
}

export interface GenerateOptions {
  readonly level: number;
  readonly seed: number;
  readonly bars?: number;
  readonly beatsPerBar?: number;
}

export function generateExercise({
  level: levelId,
  seed,
  bars = 4,
  beatsPerBar = 4,
}: GenerateOptions): Exercise {
  const level = levelById(levelId);
  const random = mulberry32(seed);
  const fifths = level.keys[Math.floor(random() * level.keys.length)] ?? 0;
  const key = keyAlterations(fifths);

  // Each hand keeps its own place, so when the melody comes back to it, it
  // carries on from where it left off rather than jumping somewhere new.
  const position: Partial<Record<TrainingClef, number>> = {};
  for (const clef of level.clefs) {
    const [low, high] = level.range[clef]!;
    position[clef] = Math.round((low + high) / 2);
  }

  const draft: Omit<GeneratedNote, 'accidental'>[] = [];
  let clef: TrainingClef = level.clefs[0]!;
  let event = 0;
  // The interval tends to stay the same from beat to beat — parallel
  // thirds or sixths, the way two-note passages are actually written.
  let size = 0;
  // Likewise a chord's shape: runs of one inversion, not a new one each beat.
  const shapeOf: Partial<Record<TrainingClef, number>> = {};

  /** What the hand on `hand` plays on this beat, as sorted staff positions. */
  const kindFor = (hand: TrainingClef): 'single' | 'interval' | 'triad' => {
    // With both hands, the left hand is the bass line: one note.
    if (level.bothHands && hand === 'bass') return 'single';
    if (level.triads) return 'triad';
    return level.intervals ? 'interval' : 'single';
  };
  /** How far the chord reaches beyond the walking note, at most. */
  const reach = (kind: 'single' | 'interval' | 'triad') =>
    kind === 'interval' ? 2 : kind === 'triad' ? (level.triads === 'root' ? 4 : 5) : 0;

  for (let measure = 1; measure <= bars; measure++) {
    // With two staves, the hand changes at a barline: half the time, but
    // never three bars running in the same hand. (Unless both hands play
    // all the time, when there is nothing to change.)
    if (level.clefs.length > 1 && measure > 1 && !level.bothHands) {
      const lastTwo = draft.filter((n) => n.measure >= measure - 2).map((n) => n.clef);
      const stuck = measure > 2 && lastTwo.every((c) => c === clef);
      if (stuck || random() < 0.5) clef = clef === 'treble' ? 'bass' : 'treble';
    }
    const hands: readonly TrainingClef[] = level.bothHands ? ['treble', 'bass'] : [clef];

    for (let beat = 0; beat < beatsPerBar; beat++) {
      for (const hand of hands) {
        const kind = kindFor(hand);
        // The melody keeps clear of the far edge by the chord's reach, so
        // there is always room for the other notes inside the range.
        const full = level.range[hand]!;
        const range: Range =
          hand === 'treble' ? [full[0] + reach(kind), full[1]] : [full[0], full[1] - reach(kind)];

        const isFirst = level.bothHands
          ? event === 0
          : draft.length === 0 || draft[draft.length - 1]!.clef !== hand;
        const current = position[hand]!;
        const next = isFirst ? current : nextPosition(current, range, random);
        position[hand] = next;

        // The walking note is the melody: the top of a chord in the right
        // hand, the bottom in the left. The other notes are added below or
        // above it, sized to stay inside the level's range.
        const below = hand === 'treble';
        const positions = [next];
        if (kind === 'interval') {
          const fits = (n: number) => (below ? next - n >= full[0] : next + n <= full[1]);
          if (size === 0 || !fits(size) || random() < 0.45) size = pickIntervalSize(random, fits);
          positions.push(below ? next - size : next + size);
          positions.sort((a, b) => a - b);
        } else if (kind === 'triad') {
          const choices = level.triads === 'root' ? [0] : [0, 1, 2];
          const fits = (i: number) => {
            const span = TRIAD_SHAPES[i]![2];
            return below ? next - span >= full[0] : next + span <= full[1];
          };
          let shape = shapeOf[hand];
          if (shape === undefined || !fits(shape) || (choices.length > 1 && random() < 0.4)) {
            const fitting = choices.filter(fits);
            shape = fitting[Math.floor(random() * fitting.length)] ?? 0;
          }
          shapeOf[hand] = shape;
          const offsets = TRIAD_SHAPES[shape]!;
          const bottom = below ? next - offsets[2] : next;
          positions.splice(0, 1, ...offsets.map((o) => bottom + o));
        }

        // At most one note of a beat is taken out of the key — two chromatic
        // notes in one interval is a harmony lesson, not a reading one. An
        // octave moves as a pair, since C with C♯ above it is not an octave.
        const chromatic = level.chromaticChance > 0 && random() < level.chromaticChance;
        let shift: Alter | null = null;
        for (const at of positions) {
          const octave = Math.floor(at / 7);
          const step = STEPS[((at % 7) + 7) % 7]!;
          let alter: Alter = key[step];
          const isMelody = at === next;
          const isOctave = positions.length === 2 && positions[1]! - positions[0]! === 7;
          if (chromatic && (isMelody || isOctave)) {
            if (shift === null) {
              const choices = ([-1, 0, 1] as const).filter((a) => a !== alter);
              shift = choices[Math.floor(random() * choices.length)]!;
            }
            alter = shift;
          }
          draft.push({
            staff: hand === 'treble' ? 1 : 2,
            clef: hand,
            step,
            octave,
            alter,
            midi: midiOf(step, octave, alter),
            measure,
            beat,
            event,
          });
        }
      }
      event++;
    }
  }

  const written = accidentalsToWrite(draft, fifths);
  const notes = draft.map((note, i) => ({ ...note, accidental: written[i] ?? null }));

  return { level: level.id, events: event, fifths, bars, beatsPerBar, notes, seed };
}

/** The exercise as a practice score: one event per beat, in order. */
export function scoreFromExercise(exercise: Exercise): Score {
  const events: ScoreEvent[] = [];
  for (let index = 0; index < exercise.events; index++) {
    const notes = exercise.notes.filter((note) => note.event === index);
    events.push({
      index,
      notes: notes.map((note) => ({ midi: note.midi, staff: note.staff, tiedFromPrevious: false })),
      measure: notes[0]!.measure,
      onsetQuarters: index,
      durationQuarters: 1,
      cursorIndex: index,
    });
  }
  return {
    title: `${levelById(exercise.level).name} · ${keySignatureByFifths(exercise.fifths).name}`,
    events,
    tempoBpm: null,
    measureCount: exercise.bars,
    source: 'training',
  };
}
