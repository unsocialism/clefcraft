import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MidiFileError, parseMidiFile, startingTempoBpm } from './midiFile.ts';
import { toMidiFile } from '../score/exportScore.ts';
import type { PdfNote } from '../pdf/pdfNotes.ts';

/** Bytes of a standard MIDI file, built event by event. */
function build(
  tracks: readonly (readonly number[])[],
  { format = 1, division = 96 }: { format?: number; division?: number } = {},
): Uint8Array {
  const chunk = (id: string, body: readonly number[]) => [
    ...[...id].map((c) => c.charCodeAt(0)),
    (body.length >> 24) & 0xff,
    (body.length >> 16) & 0xff,
    (body.length >> 8) & 0xff,
    body.length & 0xff,
    ...body,
  ];
  return Uint8Array.from([
    ...chunk('MThd', [
      (format >> 8) & 0xff,
      format & 0xff,
      (tracks.length >> 8) & 0xff,
      tracks.length & 0xff,
      (division >> 8) & 0xff,
      division & 0xff,
    ]),
    ...tracks.flatMap((body) => chunk('MTrk', [...body, 0x00, 0xff, 0x2f, 0x00])),
  ]);
}

const on = (delta: number, midi: number, velocity = 80, channel = 0) => [
  delta,
  0x90 | channel,
  midi,
  velocity,
];
const off = (delta: number, midi: number, channel = 0) => [delta, 0x80 | channel, midi, 0];

describe('reading a MIDI file', () => {
  it('reads notes with their start and length in ticks', () => {
    const file = parseMidiFile(build([[...on(0, 60), ...off(96, 60), ...on(0, 64), ...off(48, 64)]]));
    assert.equal(file.ticksPerQuarter, 96);
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.startTicks, n.durationTicks]),
      [
        [60, 0, 96],
        [64, 96, 48],
      ],
    );
  });

  it('treats a note-on with velocity 0 as a release', () => {
    const file = parseMidiFile(build([[...on(0, 60), ...on(96, 60, 0)]]));
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.durationTicks]),
      [[60, 96]],
    );
  });

  it('follows running status', () => {
    // Two note-ons sharing one status byte, then two releases likewise.
    const file = parseMidiFile(build([[0x00, 0x90, 60, 80, 0x00, 64, 80, 0x60, 60, 0x00, 0x00, 64, 0x00]]));
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.startTicks, n.durationTicks]),
      [
        [60, 0, 96],
        [64, 0, 96],
      ],
    );
  });

  it('keeps overlapping copies of the same pitch apart', () => {
    // Pedal-style: the same key struck again before the first is released.
    const file = parseMidiFile(build([[...on(0, 60), ...on(48, 60), ...off(48, 60), ...off(48, 60)]]));
    assert.deepEqual(
      file.notes.map((n) => [n.startTicks, n.durationTicks]),
      [
        [0, 96],
        [48, 96],
      ],
    );
  });

  it('reads tempo, time signature and key signature', () => {
    const file = parseMidiFile(
      build([
        [
          0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 500000 µs = 120 bpm
          0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
          0x00, 0xff, 0x59, 0x02, 0xfd, 0x00, // three flats
          0x00, 0xff, 0x03, 0x05, ...[...'Piano'].map((c) => c.charCodeAt(0)),
          ...on(0, 60),
          ...off(96, 60),
        ],
      ]),
    );
    assert.deepEqual(file.tempos, [{ ticks: 0, microsPerQuarter: 500_000 }]);
    assert.equal(startingTempoBpm(file), 120);
    assert.deepEqual(file.timeSignatures, [{ ticks: 0, beats: 3, beatType: 4 }]);
    assert.equal(file.keyFifths, -3);
    assert.equal(file.title, 'Piano');
    assert.deepEqual(file.trackNames, ['Piano']);
  });

  it('keeps each track and channel with its notes', () => {
    const file = parseMidiFile(
      build([
        [...on(0, 72, 80, 0), ...off(96, 72, 0)],
        [...on(0, 48, 80, 1), ...off(96, 48, 1)],
      ]),
    );
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.track, n.channel]),
      [
        [48, 1, 1],
        [72, 0, 0],
      ],
    );
  });

  it('skips events it has no use for, including sysex and controllers', () => {
    const file = parseMidiFile(
      build([
        [
          0x00, 0xb0, 0x07, 0x64, // volume
          0x00, 0xc0, 0x00, // program change
          0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7, // sysex
          0x00, 0xe0, 0x00, 0x40, // pitch bend
          ...on(0, 60),
          ...off(96, 60),
        ],
      ]),
    );
    assert.equal(file.notes.length, 1);
  });

  it('closes a note the file never releases', () => {
    const file = parseMidiFile(build([[...on(0, 60), 96, 0x90, 64, 80]]));
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.durationTicks]),
      [
        [60, 96],
        [64, 1],
      ],
    );
  });

  it('refuses what it cannot read, with a reason', () => {
    assert.throws(() => parseMidiFile(new Uint8Array([1, 2, 3])), MidiFileError);
    assert.throws(
      () => parseMidiFile(build([[0x00, 0xff, 0x2f, 0x00]])),
      /no notes/,
      'a file with no notes is useless for practice',
    );
    const smpte = build([[...on(0, 60), ...off(96, 60)]], { division: 0xe728 });
    assert.throws(() => parseMidiFile(smpte), /SMPTE/);
  });

  it('reads back what the app itself exports', () => {
    const note = (midi: number, staff: 1 | 2): PdfNote => ({
      page: 1,
      measure: 1,
      staff,
      system: 0,
      clef: staff === 1 ? 'treble' : 'bass',
      pitch: { step: 'C', alter: 0, octave: 4 },
      midi,
      x: 0,
      y: 0,
      centerX: 0,
      positionError: 0,
    });
    const file = parseMidiFile(
      toMidiFile([[note(60, 1), note(48, 2)], [note(62, 1)]], { title: 'Round trip' }),
    );
    assert.equal(file.format, 1);
    assert.equal(file.ticksPerQuarter, 480);
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.startTicks, n.durationTicks]),
      [
        [48, 0, 480],
        [60, 0, 480],
        [62, 480, 480],
      ],
    );
    assert.equal(file.title, 'Round trip');
    assert.equal(startingTempoBpm(file), 90);
  });
});
