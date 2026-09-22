import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { PdfNote } from '../pdf/pdfNotes.ts';
import { toMidiFile, toMusicXml, type Cluster } from './exportScore.ts';

const note = (
  midi: number,
  step: PdfNote['pitch']['step'],
  octave: number,
  measure: number,
  staff: 1 | 2,
  alter: -1 | 0 | 1 = 0,
): PdfNote => ({
  page: 1,
  measure,
  staff,
  system: 0,
  clef: staff === 1 ? 'treble' : 'bass',
  pitch: { step, alter, octave },
  midi,
  x: 0,
  y: 0,
  centerX: 0,
  positionError: 0,
});

/** Two bars: a right-hand C–E–G chord then single notes, a left-hand bass line. */
const CLUSTERS: Cluster[] = [
  [note(60, 'C', 4, 1, 1), note(64, 'E', 4, 1, 1), note(67, 'G', 4, 1, 1), note(36, 'C', 2, 1, 2)],
  [note(62, 'D', 4, 1, 1)],
  [note(43, 'G', 2, 2, 2)],
  [note(66, 'F', 4, 2, 1, 1)],
];

const decoder = new TextDecoder();

/** Read a standard MIDI file back: chunk ids, division and note events. */
function readMidi(bytes: Uint8Array) {
  const id = (at: number) => decoder.decode(bytes.subarray(at, at + 4));
  const int32 = (at: number) =>
    (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
  assert.equal(id(0), 'MThd');
  const format = (bytes[8]! << 8) | bytes[9]!;
  const tracks = (bytes[10]! << 8) | bytes[11]!;
  const division = (bytes[12]! << 8) | bytes[13]!;

  const notes: { track: number; tick: number; on: boolean; midi: number; channel: number }[] = [];
  let at = 8 + int32(4);
  for (let track = 0; track < tracks; track++) {
    assert.equal(id(at), 'MTrk', `track ${track} header`);
    const length = int32(at + 4);
    const end = at + 8 + length;
    let p = at + 8;
    let tick = 0;
    let status = 0;
    while (p < end) {
      let delta = 0;
      for (;;) {
        const b = bytes[p++]!;
        delta = (delta << 7) | (b & 0x7f);
        if ((b & 0x80) === 0) break;
      }
      tick += delta;
      let byte = bytes[p]!;
      if (byte & 0x80) {
        status = byte;
        p += 1;
      }
      byte = status;
      if (byte === 0xff) {
        p += 1; // meta type
        let length2 = 0;
        for (;;) {
          const b = bytes[p++]!;
          length2 = (length2 << 7) | (b & 0x7f);
          if ((b & 0x80) === 0) break;
        }
        p += length2;
      } else if ((byte & 0xf0) === 0x90 || (byte & 0xf0) === 0x80) {
        const midi = bytes[p]!;
        const velocity = bytes[p + 1]!;
        p += 2;
        notes.push({
          track,
          tick,
          on: (byte & 0xf0) === 0x90 && velocity > 0,
          midi,
          channel: byte & 0x0f,
        });
      } else {
        p += 2;
      }
    }
    at = end;
  }
  return { format, tracks, division, notes };
}

describe('exporting a PDF reading as MIDI', () => {
  it('writes a type 1 file with a track for each hand', () => {
    const midi = readMidi(toMidiFile(CLUSTERS, { title: 'Test' }));
    assert.equal(midi.format, 1);
    assert.equal(midi.tracks, 3, 'tempo track plus one per hand');
    assert.equal(midi.division, 480);
  });

  it('puts each hand on its own track and channel', () => {
    const { notes } = readMidi(toMidiFile(CLUSTERS));
    const right = notes.filter((n) => n.track === 1);
    const left = notes.filter((n) => n.track === 2);
    assert.deepEqual(
      [...new Set(right.filter((n) => n.on).map((n) => n.midi))].sort((a, b) => a - b),
      [60, 62, 64, 66, 67],
    );
    assert.deepEqual(
      [...new Set(left.filter((n) => n.on).map((n) => n.midi))].sort((a, b) => a - b),
      [36, 43],
    );
    assert.ok(right.every((n) => n.channel === 0));
    assert.ok(left.every((n) => n.channel === 1));
  });

  it('gives every event one quarter note, in order, chords together', () => {
    const { notes } = readMidi(toMidiFile(CLUSTERS));
    const ons = notes.filter((n) => n.on);
    const chord = ons.filter((n) => [60, 64, 67].includes(n.midi));
    assert.equal(chord.length, 3);
    assert.ok(chord.every((n) => n.tick === 0), 'a chord starts together');
    // Event 1 is the D, event 3 the F♯: one quarter apart each time.
    assert.equal(ons.find((n) => n.midi === 62)!.tick, 480);
    assert.equal(ons.find((n) => n.midi === 66)!.tick, 3 * 480);
    const off = notes.find((n) => !n.on && n.midi === 62)!;
    assert.equal(off.tick, 2 * 480, 'and lasts exactly one quarter');
  });

  it('is empty but valid for a reading with no notes', () => {
    const midi = readMidi(toMidiFile([]));
    assert.equal(midi.tracks, 3);
    assert.equal(midi.notes.length, 0);
  });
});

describe('exporting a PDF reading as MusicXML', () => {
  const xml = toMusicXml(CLUSTERS, { title: 'My <Score> & "more"', fifths: -1 });

  it('is a two-staff piano part with the title escaped', () => {
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<work-title>My &lt;Score&gt; &amp; &quot;more&quot;</work-title>'));
    assert.ok(xml.includes('<staves>2</staves>'));
    assert.ok(xml.includes('<clef number="1"><sign>G</sign><line>2</line></clef>'));
    assert.ok(xml.includes('<clef number="2"><sign>F</sign><line>4</line></clef>'));
    assert.ok(xml.includes('<key><fifths>-1</fifths></key>'));
    assert.ok(xml.trimEnd().endsWith('</score-partwise>'));
  });

  it('writes one measure per measure read, as long as the events in it', () => {
    const measures = [...xml.matchAll(/<measure number="(\d+)"/g)].map((m) => m[1]);
    assert.deepEqual(measures, ['1', '2']);
    // Two events in the first bar, two in the second.
    assert.equal([...xml.matchAll(/<beats>2<\/beats>/g)].length, 1, 'stated once, then unchanged');
  });

  it('stacks a chord and states an alteration', () => {
    const first = xml.slice(xml.indexOf('<measure number="1"'), xml.indexOf('<measure number="2"'));
    assert.equal([...first.matchAll(/<chord\/>/g)].length, 2, 'three notes: two are chord tones');
    assert.ok(xml.includes('<step>F</step>\n          <alter>1</alter>'));
  });

  it('rests where a hand is silent, so the hands stay aligned', () => {
    // The left hand plays only on event 0 of bar 1 and event 0 of bar 2.
    const rests = [...xml.matchAll(/<rest\/>/g)].length;
    assert.equal(rests, 3);
    const first = xml.slice(xml.indexOf('<measure number="1"'), xml.indexOf('<measure number="2"'));
    assert.ok(first.includes('<backup><duration>2</duration></backup>'));
  });

  it('puts each hand on its own staff and voice', () => {
    const staff1 = [...xml.matchAll(/<staff>1<\/staff>/g)].length;
    const staff2 = [...xml.matchAll(/<staff>2<\/staff>/g)].length;
    assert.equal(staff1, 6, 'five right-hand notes plus one rest');
    assert.equal(staff2, 4, 'two left-hand notes plus two rests');
    assert.ok(xml.includes('<voice>1</voice>'));
    assert.ok(xml.includes('<voice>5</voice>'));
  });

  it('handles a reading with no notes without inventing a measure', () => {
    const empty = toMusicXml([]);
    assert.ok(!empty.includes('<measure'));
    assert.ok(empty.includes('</score-partwise>'));
  });
});
