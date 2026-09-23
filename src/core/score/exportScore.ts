/**
 * Taking a PDF reading out of the app, corrections and all.
 *
 * What a PDF gives us is pitches, chords and barlines — never rhythm (see
 * pdfNotes.ts). So both formats here write every event as one quarter note,
 * which is a lie about the durations and honest about the pitches. That is
 * the point: the export is for feeding the notes into something else — a
 * notation editor where you can set the rhythm, or a player that just
 * sounds them — not for reproducing the original engraving.
 *
 * A measure is as long as the number of events in it, so what lines up on
 * the page still lines up in the file, and each hand keeps its own staff.
 */

import type { PdfNote } from '../pdf/pdfNotes.ts';
import {
  TICKS_PER_QUARTER,
  conductorTrack,
  header,
  noteTrack,
  type NoteEvent,
} from '../midi/writeMidi.ts';

/** One moment: the notes drawn at the same horizontal position. */
export type Cluster = readonly PdfNote[];

export interface ExportOptions {
  readonly title?: string;
  /** Sharps positive, flats negative. Cosmetic: every note states its own pitch. */
  readonly fifths?: number;
  /** Written into the file so its origin is not a mystery later. */
  readonly software?: string;
}

interface Bar {
  readonly measure: number;
  readonly events: Cluster[];
}

/** Group the events into measures, keeping their order. */
function bars(clusters: readonly Cluster[]): Bar[] {
  const out: Bar[] = [];
  for (const cluster of clusters) {
    const measure = cluster[0]?.measure ?? 0;
    const last = out[out.length - 1];
    if (last && last.measure === measure) last.events.push(cluster);
    else out.push({ measure, events: [cluster] });
  }
  return out;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function xml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

function noteXml(note: PdfNote, chord: boolean, staff: number): string {
  const { step, alter, octave } = note.pitch;
  return [
    '      <note>',
    chord ? '        <chord/>' : null,
    '        <pitch>',
    `          <step>${step}</step>`,
    alter === 0 ? null : `          <alter>${alter}</alter>`,
    `          <octave>${octave}</octave>`,
    '        </pitch>',
    '        <duration>1</duration>',
    `        <voice>${staff === 1 ? 1 : 5}</voice>`,
    '        <type>quarter</type>',
    `        <staff>${staff}</staff>`,
    '      </note>',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function restXml(staff: number): string {
  return [
    '      <note>',
    '        <rest/>',
    '        <duration>1</duration>',
    `        <voice>${staff === 1 ? 1 : 5}</voice>`,
    '        <type>quarter</type>',
    `        <staff>${staff}</staff>`,
    '      </note>',
  ].join('\n');
}

/**
 * A MusicXML file: a piano part on two staves, one quarter note per event,
 * with a rest wherever a hand is silent so the hands stay aligned.
 */
export function toMusicXml(clusters: readonly Cluster[], options: ExportOptions = {}): string {
  const { title = 'Untitled', fifths = 0, software = 'clefcraft' } = options;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    '  <work>',
    `    <work-title>${xml(title)}</work-title>`,
    '  </work>',
    '  <identification>',
    '    <encoding>',
    `      <software>${xml(software)}</software>`,
    '      <encoding-description>Pitches read from a PDF; rhythm is not read, so every note is a quarter.</encoding-description>',
    '    </encoding>',
    '  </identification>',
    '  <part-list>',
    '    <score-part id="P1">',
    '      <part-name>Piano</part-name>',
    '    </score-part>',
    '  </part-list>',
    '  <part id="P1">',
  ];

  const grouped = bars(clusters);
  let beats = 0;
  grouped.forEach((bar, index) => {
    lines.push(`    <measure number="${index + 1}">`);
    const first = index === 0;
    if (first || bar.events.length !== beats) {
      // A measure lasts as many quarters as it holds events, so the time
      // signature follows the page rather than pretending to know better.
      beats = bar.events.length;
      lines.push('      <attributes>');
      if (first) lines.push('        <divisions>1</divisions>');
      if (first) lines.push(`        <key><fifths>${fifths}</fifths></key>`);
      lines.push(`        <time><beats>${beats}</beats><beat-type>4</beat-type></time>`);
      if (first) {
        lines.push('        <staves>2</staves>');
        lines.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
        lines.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      }
      lines.push('      </attributes>');
    }

    for (const staff of [1, 2] as const) {
      if (staff === 2) lines.push(`      <backup><duration>${bar.events.length}</duration></backup>`);
      for (const event of bar.events) {
        const notes = event
          .filter((n) => (n.staff <= 1 ? 1 : 2) === staff)
          .sort((a, b) => a.midi - b.midi);
        if (notes.length === 0) {
          lines.push(restXml(staff));
          continue;
        }
        notes.forEach((note, i) => lines.push(noteXml(note, i > 0, staff)));
      }
    }
    lines.push('    </measure>');
  });

  lines.push('  </part>', '</score-partwise>', '');
  return lines.join('\n');
}

// ---- MIDI ----

interface MidiOptions extends ExportOptions {
  /** Quarter notes per minute written into the file. */
  readonly tempoBpm?: number;
}

/**
 * A standard MIDI file: one track per hand, one quarter note per event.
 *
 * Type 1 with two tracks rather than one, so the hands can be told apart —
 * and muted separately — in whatever it is opened with.
 */
export function toMidiFile(clusters: readonly Cluster[], options: MidiOptions = {}): Uint8Array {
  const { title = 'Untitled', tempoBpm = 90, software = 'clefcraft' } = options;

  const handTrack = (staff: 1 | 2, name: string, channel: number): number[] => {
    // Every event lasts one quarter, so an event's start is its index.
    const events: NoteEvent[] = [];
    clusters.forEach((cluster, index) => {
      for (const note of cluster) {
        if ((note.staff <= 1 ? 1 : 2) !== staff) continue;
        events.push({ tick: index * TICKS_PER_QUARTER, on: true, midi: note.midi, velocity: 80 });
        events.push({
          tick: (index + 1) * TICKS_PER_QUARTER,
          on: false,
          midi: note.midi,
          velocity: 0,
        });
      }
    });
    return noteTrack(events, { name, channel });
  };

  return Uint8Array.from([
    ...header(3), // tempo, right hand, left hand
    ...conductorTrack({
      title,
      comment: `${software}: pitches read from a PDF; rhythm is not read.`,
      tempoBpm,
    }),
    ...handTrack(1, 'Right hand', 0),
    ...handTrack(2, 'Left hand', 1),
  ]);
}
