/**
 * Turning notes read off a PDF into something the practice engine can use.
 *
 * A MusicXML file states which notes sound together. A PDF does not: it
 * only shows where they were drawn. But an engraver aligns simultaneous
 * notes vertically — that is the whole convention that lets a pianist read
 * a grand staff at all — so notes sharing a horizontal position within a
 * system are the ones to play together.
 *
 * The one case this gets wrong is a chord containing a second. Two notes a
 * step apart cannot both sit on the same side of the stem, so the engraver
 * offsets one by a notehead's width, and it reads here as the next event
 * rather than part of this one. You would play both notes, just fractionally
 * apart. Rhythm is not read at all, so every event is given the same
 * nominal length and tempo mode is not meaningful for a PDF.
 */

import type { PdfNote } from '../pdf/pdfNotes.ts';
import type { Score, ScoreEvent, ScoreNote } from './types.ts';

/** Where an event sits on the page, so the overlay can point at it. */
export interface PdfAnchor {
  readonly page: number;
  readonly x: number;
  /** The notehead positions in this event, in PDF Y. */
  readonly ys: readonly number[];
  /** The staff of each notehead, parallel to `ys` — which hand plays it. */
  readonly staves: readonly number[];
}

export interface PdfScore {
  readonly score: Score;
  /** One entry per event, in the same order. */
  readonly anchors: readonly PdfAnchor[];
  /**
   * The notes behind each event, in the same order — with their written
   * spelling, which the score itself does not carry. Used by the export.
   */
  readonly clusters: readonly (readonly PdfNote[])[];
}

export interface PdfScoreOptions {
  readonly title?: string;
  /**
   * How close two noteheads must be horizontally to count as simultaneous,
   * as a fraction of a staff space. A notehead is about 1.2 spaces wide, so
   * staying well under that keeps a displaced second from swallowing the
   * note after it; consecutive notes in a run sit at least two spaces apart.
   */
  readonly clusterSpaces?: number;
  /** Staff spacing in points; used with `clusterSpaces`. */
  readonly spacing?: number;
}

export function scoreFromPdfNotes(
  notes: readonly PdfNote[],
  options: PdfScoreOptions = {},
): PdfScore {
  const { title = '', clusterSpaces = 0.6, spacing = 5 } = options;
  const tolerance = Math.max(0.5, spacing * clusterSpaces);

  const ordered = [...notes].sort(
    (a, b) => a.system - b.system || a.x - b.x || a.staff - b.staff || b.y - a.y,
  );

  const clusters: PdfNote[][] = [];
  for (const note of ordered) {
    const last = clusters[clusters.length - 1];
    const head = last?.[0];
    // A new system always starts a new event, however the x values line up:
    // two systems share the same horizontal range on the page.
    if (last && head && head.system === note.system && note.x - head.x <= tolerance) {
      last.push(note);
    } else clusters.push([note]);
  }

  const events: ScoreEvent[] = [];
  const anchors: PdfAnchor[] = [];
  for (const [index, cluster] of clusters.entries()) {
    const seen = new Set<number>();
    const eventNotes: ScoreNote[] = [];
    for (const note of cluster) {
      // The same pitch twice at one moment is one key to press.
      if (seen.has(note.midi)) continue;
      seen.add(note.midi);
      eventNotes.push({ midi: note.midi, staff: note.staff, tiedFromPrevious: false });
    }
    events.push({
      index,
      notes: eventNotes,
      measure: cluster[0]!.measure,
      // No rhythm is read, so every event is given the same nominal length.
      onsetQuarters: index,
      durationQuarters: 1,
      cursorIndex: index,
    });
    anchors.push({
      page: cluster[0]!.page,
      x: cluster.reduce((sum, n) => sum + n.centerX, 0) / cluster.length,
      ys: cluster.map((n) => n.y),
      staves: cluster.map((n) => n.staff),
    });
  }

  const measures = notes.reduce((max, n) => Math.max(max, n.measure), 0);

  return {
    score: { title, events, tempoBpm: null, measureCount: measures, source: 'pdf' },
    anchors,
    clusters,
  };
}
