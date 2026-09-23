/**
 * Turning a MIDI file into something that can be both practised and read.
 *
 * A MIDI file says exactly when each note starts and stops, which is more
 * than a PDF ever gives us — real rhythm, so play-along works. What it does
 * not say is how the music is *written*: which hand plays what, where the
 * barlines fall for the eye, or whether a held note is one note or two tied
 * together. Those are engraving decisions, and they are made here.
 *
 * Three of them are worth knowing about, because they are what make a
 * performance fit on a page at all:
 *
 *   - Timing is rounded to the nearest sixteenth. A file played in by hand
 *     has no exact durations; left as they are, every bar would be a thicket
 *     of unreadable dotted sixty-fourths. Anything shorter than a sixteenth
 *     — grace notes, a rolled chord — lands on the same grid as its
 *     neighbours and joins them.
 *   - Each hand is written as a single line of rhythm. Real piano writing
 *     has two or three voices per staff; splitting them out reliably is a
 *     research problem. Here, notes starting together become a chord, and a
 *     held note is cut short when the next chord in that hand arrives.
 *   - A note crossing a barline is split and tied, as it would be on paper.
 *
 * So the notation is a fair reading of the performance, not a reconstruction
 * of the original score. The pitches and their order are exact.
 */

import { spellNote } from '../music/pitch.ts';
import type { MidiFile, MidiFileNote } from '../midi/midiFile.ts';
import { startingTempoBpm } from '../midi/midiFile.ts';
import type { Score, ScoreEvent, ScoreNote } from './types.ts';

/** Note values a duration is written with, in sixteenths. */
const VALUES: readonly { sixteenths: number; duration: string; dots: number }[] = [
  { sixteenths: 16, duration: 'w', dots: 0 },
  { sixteenths: 12, duration: 'h', dots: 1 },
  { sixteenths: 8, duration: 'h', dots: 0 },
  { sixteenths: 6, duration: 'q', dots: 1 },
  { sixteenths: 4, duration: 'q', dots: 0 },
  { sixteenths: 3, duration: '8', dots: 1 },
  { sixteenths: 2, duration: '8', dots: 0 },
  { sixteenths: 1, duration: '16', dots: 0 },
];

export interface EngravedNote {
  readonly midi: number;
  readonly step: string;
  readonly alter: number;
  readonly octave: number;
}

export interface EngravedEntry {
  readonly rest: boolean;
  /** VexFlow duration letter: w, h, q, 8 or 16. */
  readonly duration: string;
  readonly dots: number;
  readonly notes: readonly EngravedNote[];
  /** Quarter notes from the start of the piece. */
  readonly onsetQuarters: number;
  readonly lengthQuarters: number;
  /** The practice event this entry is, or null for a rest or a tie's tail. */
  readonly eventIndex: number | null;
  /** Tied to the entry after it — the same sound written twice. */
  readonly tieToNext: boolean;
}

export interface EngravedMeasure {
  /** 1-based, as printed. */
  readonly number: number;
  readonly beats: number;
  readonly beatType: number;
  /** Index 0 is the right hand, 1 the left. */
  readonly staves: readonly [readonly EngravedEntry[], readonly EngravedEntry[]];
}

export interface MidiScore {
  readonly score: Score;
  readonly measures: readonly EngravedMeasure[];
  /** Sharps positive, flats negative. */
  readonly fifths: number;
  /** How the hands were decided, for the UI to say. */
  readonly handsFrom: 'tracks' | 'channels' | 'split';
  readonly splitPoint: number;
}

export interface MidiScoreOptions {
  readonly title?: string;
  /**
   * Notes below this go to the left hand when the file gives no other clue.
   * Middle C by default.
   */
  readonly splitPoint?: number;
}

/** How a duration in sixteenths is written: one entry, or several tied. */
export function writeDuration(sixteenths: number): { duration: string; dots: number }[] {
  const out: { duration: string; dots: number }[] = [];
  let left = Math.max(1, Math.round(sixteenths));
  // Longest first, so a bar of silence is one whole rest and not sixteen
  // sixteenths. Anything the list cannot express exactly comes out as a
  // couple of tied values, which is how it would be written by hand.
  while (left > 0) {
    const value = VALUES.find((v) => v.sixteenths <= left);
    if (!value) break;
    out.push({ duration: value.duration, dots: value.dots });
    left -= value.sixteenths;
  }
  return out;
}

interface Staffed extends MidiFileNote {
  readonly staff: 1 | 2;
}

/**
 * Which hand plays what.
 *
 * A file written by notation software keeps the hands apart already, as two
 * tracks or two channels; the one with the lower notes is the left. Failing
 * that — a single-track file, as most performances are — the split is by
 * pitch, which is right far more often than it is wrong.
 */
function assignHands(
  notes: readonly MidiFileNote[],
  splitPoint: number,
): { notes: Staffed[]; handsFrom: MidiScore['handsFrom'] } {
  const groupBy = (key: (n: MidiFileNote) => number): Map<number, MidiFileNote[]> => {
    const groups = new Map<number, MidiFileNote[]>();
    for (const note of notes) {
      const id = key(note);
      groups.set(id, [...(groups.get(id) ?? []), note]);
    }
    return groups;
  };

  for (const [how, key] of [
    ['tracks', (n: MidiFileNote) => n.track],
    ['channels', (n: MidiFileNote) => n.channel],
  ] as const) {
    const groups = [...groupBy(key)].filter(([, list]) => list.length > 0);
    if (groups.length !== 2) continue;
    const mean = (list: readonly MidiFileNote[]) =>
      list.reduce((sum, n) => sum + n.midi, 0) / list.length;
    const [a, b] = groups as [[number, MidiFileNote[]], [number, MidiFileNote[]]];
    const upper = mean(a[1]) >= mean(b[1]) ? a[0] : b[0];
    return {
      notes: notes.map((n) => ({ ...n, staff: key(n) === upper ? 1 : 2 })),
      handsFrom: how,
    };
  }

  return {
    notes: notes.map((n) => ({ ...n, staff: n.midi >= splitPoint ? 1 : 2 })),
    handsFrom: 'split',
  };
}

/** Measure boundaries in ticks, following any time signature changes. */
function measureGrid(
  file: MidiFile,
  endTicks: number,
): { startTicks: number; lengthTicks: number; beats: number; beatType: number }[] {
  const signatures =
    file.timeSignatures.length > 0
      ? [...file.timeSignatures]
      : [{ ticks: 0, beats: 4, beatType: 4 }];
  if (signatures[0]!.ticks > 0) signatures.unshift({ ticks: 0, beats: 4, beatType: 4 });

  const bars: { startTicks: number; lengthTicks: number; beats: number; beatType: number }[] = [];
  for (const [index, signature] of signatures.entries()) {
    const until = signatures[index + 1]?.ticks ?? endTicks;
    const lengthTicks = Math.max(
      1,
      Math.round((signature.beats * 4 * file.ticksPerQuarter) / signature.beatType),
    );
    for (let at = signature.ticks; at < Math.max(until, signature.ticks + 1); at += lengthTicks) {
      bars.push({
        startTicks: at,
        lengthTicks,
        beats: signature.beats,
        beatType: signature.beatType,
      });
      if (bars.length > 5000) return bars; // a runaway file is not worth hanging on
    }
  }
  return bars;
}

export function scoreFromMidi(file: MidiFile, options: MidiScoreOptions = {}): MidiScore {
  const { title = file.title ?? 'MIDI file', splitPoint = 60 } = options;
  const fifths = file.keyFifths ?? 0;
  const grid = Math.max(1, Math.round(file.ticksPerQuarter / 4)); // a sixteenth

  // Percussion is not piano music; channel 10 (9 counting from zero) is
  // where it lives by convention.
  const played = file.notes.filter((n) => n.channel !== 9);
  const { notes: staffed, handsFrom } = assignHands(played, splitPoint);

  const quantize = (ticks: number) => Math.round(ticks / grid) * grid;
  const snapped = staffed.map((n) => {
    const start = quantize(n.startTicks);
    const end = Math.max(start + grid, quantize(n.startTicks + n.durationTicks));
    return { ...n, startTicks: start, durationTicks: end - start };
  });

  const endTicks = snapped.reduce((max, n) => Math.max(max, n.startTicks + n.durationTicks), 0);
  const bars = measureGrid(file, Math.max(endTicks, 1));

  // ---- the practice score: one event per moment, both hands together ----
  const byOnset = new Map<number, Staffed[]>();
  for (const note of snapped) byOnset.set(note.startTicks, [...(byOnset.get(note.startTicks) ?? []), note]);
  const onsets = [...byOnset.keys()].sort((a, b) => a - b);

  const events: ScoreEvent[] = onsets.map((ticks, index) => {
    const seen = new Set<number>();
    const notes: ScoreNote[] = [];
    for (const note of byOnset.get(ticks)!.sort((a, b) => a.staff - b.staff || b.midi - a.midi)) {
      if (seen.has(note.midi)) continue;
      seen.add(note.midi);
      notes.push({ midi: note.midi, staff: note.staff, tiedFromPrevious: false });
    }
    // The last event has no next onset to measure against, so it lasts as
    // long as its own longest note.
    const next =
      onsets[index + 1] ??
      Math.max(...byOnset.get(ticks)!.map((n) => n.startTicks + n.durationTicks));
    const measure = bars.findIndex(
      (bar) => ticks >= bar.startTicks && ticks < bar.startTicks + bar.lengthTicks,
    );
    return {
      index,
      notes,
      measure: (measure < 0 ? bars.length - 1 : measure) + 1,
      onsetQuarters: ticks / file.ticksPerQuarter,
      durationQuarters: (next - ticks) / file.ticksPerQuarter,
      cursorIndex: index,
    };
  });
  const eventAt = new Map(onsets.map((ticks, index) => [ticks, index]));

  // ---- the engraving: one line of rhythm per hand, bar by bar ----
  const spell = (midi: number): EngravedNote => {
    const s = spellNote(midi, fifths);
    return { midi, step: s.step, alter: s.alter, octave: s.octave };
  };

  const measures: EngravedMeasure[] = bars.map((bar, index) => {
    const staves = ([1, 2] as const).map((staff) => {
      const entries: EngravedEntry[] = [];
      const inBar = snapped
        .filter((n) => n.staff === staff && n.startTicks < bar.startTicks + bar.lengthTicks)
        .filter((n) => n.startTicks + n.durationTicks > bar.startTicks);

      const push = (at: number, until: number, notes: readonly EngravedNote[], event: number | null) => {
        const sixteenths = (until - at) / grid;
        if (sixteenths <= 0) return;
        const pieces = writeDuration(sixteenths);
        pieces.forEach((piece, i) => {
          const already = pieces
            .slice(0, i)
            .reduce((sum, p) => sum + VALUES.find((v) => v.duration === p.duration && v.dots === p.dots)!.sixteenths, 0);
          const own = VALUES.find((v) => v.duration === piece.duration && v.dots === piece.dots)!.sixteenths;
          entries.push({
            rest: notes.length === 0,
            duration: piece.duration,
            dots: piece.dots,
            notes,
            onsetQuarters: (at + already * grid) / file.ticksPerQuarter,
            lengthQuarters: (own * grid) / file.ticksPerQuarter,
            // Only the first piece is the note you play; the rest are its
            // tail, tied on.
            eventIndex: i === 0 ? event : null,
            tieToNext: notes.length > 0 && i < pieces.length - 1,
          });
        });
      };

      let at = bar.startTicks;
      const barEnd = bar.startTicks + bar.lengthTicks;

      // A note that began in an earlier bar is the tail of a tie: it holds
      // the start of this bar until it ends or the next note arrives, and
      // it is not something to play again.
      const carried = inBar.filter((n) => n.startTicks < bar.startTicks);
      const fresh = [...new Set(inBar.filter((n) => n.startTicks >= bar.startTicks).map((n) => n.startTicks))].sort(
        (a, b) => a - b,
      );
      if (carried.length > 0) {
        const until = Math.min(
          Math.max(...carried.map((n) => n.startTicks + n.durationTicks)),
          fresh[0] ?? barEnd,
          barEnd,
        );
        const notes = [...new Set(carried.map((n) => n.midi))].sort((a, b) => a - b).map(spell);
        push(bar.startTicks, until, notes, null);
        at = until;
      }

      for (const start of fresh) {
        if (start > at) push(at, start, [], null); // silence before this chord
        const chord = inBar.filter((n) => n.startTicks === start);
        const next = fresh.find((s) => s > start) ?? barEnd;
        const longest = Math.max(...chord.map((n) => n.startTicks + n.durationTicks));
        const until = Math.min(next, longest, barEnd);
        const notes = [...new Set(chord.map((n) => n.midi))].sort((a, b) => a - b).map(spell);
        push(start, until, notes, eventAt.get(start) ?? null);
        at = Math.max(at, until);
      }
      if (at < barEnd) push(at, barEnd, [], null);

      // A bar with nothing in it is written as one rest, not several.
      if (entries.every((e) => e.rest)) {
        const whole = writeDuration(bar.lengthTicks / grid);
        return whole.map((piece, i) => ({
          rest: true,
          duration: piece.duration,
          dots: piece.dots,
          notes: [] as EngravedNote[],
          onsetQuarters: bar.startTicks / file.ticksPerQuarter,
          lengthQuarters: bar.lengthTicks / file.ticksPerQuarter,
          eventIndex: null,
          tieToNext: false,
          ...(i > 0 ? {} : {}),
        }));
      }
      return entries;
    });

    return {
      number: index + 1,
      beats: bar.beats,
      beatType: bar.beatType,
      staves: [staves[0]!, staves[1]!] as const,
    };
  });

  // Ties across a barline: a note cut off at the end of one bar and taken up
  // at the start of the next is one sound, written twice.
  for (const [index, measure] of measures.entries()) {
    const next = measures[index + 1];
    if (!next) continue;
    for (const staff of [0, 1] as const) {
      const last = measure.staves[staff][measure.staves[staff].length - 1];
      const first = next.staves[staff][0];
      if (!last || !first || last.rest || first.rest) continue;
      const continues =
        first.eventIndex === null &&
        last.notes.length === first.notes.length &&
        last.notes.every((n, i) => n.midi === first.notes[i]!.midi);
      if (continues) {
        (measure.staves[staff] as EngravedEntry[])[measure.staves[staff].length - 1] = {
          ...last,
          tieToNext: true,
        };
      }
    }
  }

  const score: Score = {
    title,
    events,
    tempoBpm: startingTempoBpm(file),
    measureCount: measures.length,
    source: 'midi',
  };

  return { score, measures, fifths, handsFrom, splitPoint };
}
