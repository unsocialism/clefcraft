import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseMidiFile } from '../midi/midiFile.ts';
import { scoreFromMidi, writeDuration } from './midiScore.ts';

const TPQ = 96;

/** Bytes of a standard MIDI file, built event by event. */
function build(tracks: readonly (readonly number[])[], division = TPQ): Uint8Array {
  const chunk = (id: string, body: readonly number[]) => [
    ...[...id].map((c) => c.charCodeAt(0)),
    (body.length >> 24) & 0xff,
    (body.length >> 16) & 0xff,
    (body.length >> 8) & 0xff,
    body.length & 0xff,
    ...body,
  ];
  return Uint8Array.from([
    ...chunk('MThd', [0, 1, 0, tracks.length, (division >> 8) & 0xff, division & 0xff]),
    ...chunk('MTrk', [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]).slice(0, 0), // (tempo added per test)
    ...tracks.flatMap((body) => chunk('MTrk', [...body, 0x00, 0xff, 0x2f, 0x00])),
  ]);
}

const varlen = (value: number): number[] => {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
};

/** A track from (start, length, pitch) triples, in ticks. */
function track(
  notes: readonly { at: number; ticks: number; midi: number; channel?: number }[],
  meta: readonly number[] = [],
): number[] {
  const events: { at: number; bytes: number[] }[] = [];
  for (const note of notes) {
    const channel = note.channel ?? 0;
    events.push({ at: note.at, bytes: [0x90 | channel, note.midi, 80] });
    events.push({ at: note.at + note.ticks, bytes: [0x80 | channel, note.midi, 0] });
  }
  events.sort((a, b) => a.at - b.at);
  const out = [...meta];
  let last = 0;
  for (const event of events) {
    out.push(...varlen(event.at - last), ...event.bytes);
    last = event.at;
  }
  return out;
}

const TIME_3_4 = [0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08];
const TEMPO_120 = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
const read = (bytes: Uint8Array, options = {}) => scoreFromMidi(parseMidiFile(bytes), options);
const shape = (entries: readonly { rest: boolean; duration: string; dots: number; tieToNext: boolean }[]) =>
  entries.map((e) => `${e.rest ? 'r' : 'n'}${e.duration}${'.'.repeat(e.dots)}${e.tieToNext ? '~' : ''}`);

describe('writing a length as note values', () => {
  it('uses one value where one will do', () => {
    assert.deepEqual(writeDuration(16), [{ duration: 'w', dots: 0 }]);
    assert.deepEqual(writeDuration(8), [{ duration: 'h', dots: 0 }]);
    assert.deepEqual(writeDuration(4), [{ duration: 'q', dots: 0 }]);
    assert.deepEqual(writeDuration(2), [{ duration: '8', dots: 0 }]);
    assert.deepEqual(writeDuration(1), [{ duration: '16', dots: 0 }]);
  });

  it('dots rather than ties where a dot says it', () => {
    assert.deepEqual(writeDuration(6), [{ duration: 'q', dots: 1 }]);
    assert.deepEqual(writeDuration(3), [{ duration: '8', dots: 1 }]);
    assert.deepEqual(writeDuration(12), [{ duration: 'h', dots: 1 }]);
  });

  it('ties two values together for a length no single value has', () => {
    assert.deepEqual(writeDuration(5), [
      { duration: 'q', dots: 0 },
      { duration: '16', dots: 0 },
    ]);
    assert.deepEqual(writeDuration(7), [
      { duration: 'q', dots: 1 },
      { duration: '16', dots: 0 },
    ]);
    assert.deepEqual(writeDuration(20), [
      { duration: 'w', dots: 0 },
      { duration: 'q', dots: 0 },
    ]);
  });
});

describe('reading a MIDI file as a score', () => {
  it('keeps the timing the file states, in quarter notes', () => {
    const midi = build([
      track(
        [
          { at: 0, ticks: TPQ, midi: 60 },
          { at: TPQ, ticks: TPQ / 2, midi: 62 },
          { at: TPQ * 1.5, ticks: TPQ / 2, midi: 64 },
        ],
        TEMPO_120,
      ),
    ]);
    const { score, measures } = read(midi);
    assert.equal(score.tempoBpm, 120);
    assert.deepEqual(
      score.events.map((e) => [e.onsetQuarters, e.durationQuarters, e.notes[0]!.midi]),
      [
        [0, 1, 60],
        [1, 0.5, 62],
        [1.5, 0.5, 64],
      ],
    );
    assert.deepEqual(shape(measures[0]!.staves[0]), ['nq', 'n8', 'n8', 'rh']);
  });

  it('rounds a hand-played performance to the nearest sixteenth', () => {
    // Nothing lands on the grid: a real recording never does.
    const midi = build([
      track([
        { at: 3, ticks: TPQ - 7, midi: 60 },
        { at: TPQ + 5, ticks: TPQ - 2, midi: 62 },
      ]),
    ]);
    const { score } = read(midi);
    assert.deepEqual(
      score.events.map((e) => e.onsetQuarters),
      [0, 1],
    );
    assert.deepEqual(
      score.events.map((e) => e.durationQuarters),
      [1, 1],
    );
  });

  it('gives a note shorter than a sixteenth a sixteenth, rather than nothing', () => {
    const midi = build([track([{ at: 0, ticks: 2, midi: 60 }])]);
    const { measures } = read(midi);
    assert.equal(measures[0]!.staves[0][0]!.duration, '16');
    assert.equal(measures[0]!.staves[0][0]!.rest, false);
  });

  it('plays notes that start together as one chord, in both hands at once', () => {
    const midi = build([
      track([
        { at: 0, ticks: TPQ, midi: 64 },
        { at: 0, ticks: TPQ, midi: 67 },
        { at: 0, ticks: TPQ, midi: 48 },
      ]),
    ]);
    const { score } = read(midi);
    assert.equal(score.events.length, 1);
    assert.deepEqual(
      score.events[0]!.notes.map((n) => [n.midi, n.staff]),
      [
        [67, 1],
        [64, 1],
        [48, 2],
      ],
    );
  });

  it('follows the time signature for the barlines', () => {
    const midi = build([
      track(
        Array.from({ length: 6 }, (_, i) => ({ at: i * TPQ, ticks: TPQ, midi: 60 + i })),
        TIME_3_4,
      ),
    ]);
    const { measures, score } = read(midi);
    assert.equal(measures.length, 2);
    assert.equal(measures[0]!.beats, 3);
    assert.deepEqual(
      score.events.map((e) => e.measure),
      [1, 1, 1, 2, 2, 2],
    );
  });

  it('splits a note that crosses a barline and ties it', () => {
    // Six quarters from the downbeat, in 4/4: a whole tied to a half.
    const midi = build([track([{ at: 0, ticks: TPQ * 6, midi: 60 }])]);
    const { measures, score } = read(midi);
    assert.deepEqual(shape(measures[0]!.staves[0]), ['nw~']);
    assert.deepEqual(shape(measures[1]!.staves[0]), ['nh', 'rh']);
    assert.equal(measures[1]!.staves[0][0]!.eventIndex, null, 'the tail is not struck again');
    assert.equal(score.events.length, 1, 'and it is one note to play, not two');
  });

  it('fills silence with rests, and an empty bar with one rest', () => {
    const midi = build([
      track([
        { at: TPQ, ticks: TPQ, midi: 60 },
        { at: TPQ * 9, ticks: TPQ, midi: 60 },
      ]),
    ]);
    const { measures } = read(midi);
    assert.deepEqual(shape(measures[0]!.staves[0]), ['rq', 'nq', 'rh']);
    assert.deepEqual(shape(measures[1]!.staves[0]), ['rw'], 'a whole bar of silence is one rest');
    assert.deepEqual(shape(measures[0]!.staves[1]), ['rw'], 'and so is an unused hand');
  });

  it('spells notes by the key signature the file states', () => {
    const flats = [0x00, 0xff, 0x59, 0x02, 0xfb, 0x00]; // five flats
    const midi = build([track([{ at: 0, ticks: TPQ, midi: 66 }], flats)]);
    const { measures, fifths } = read(midi);
    assert.equal(fifths, -5);
    assert.deepEqual(measures[0]!.staves[0][0]!.notes[0], {
      midi: 66,
      step: 'G',
      alter: -1,
      octave: 4,
    });
  });

  it('cuts a held note short when the same hand plays again', () => {
    // A pedalled performance: the first note still sounding when the next
    // arrives. One line of rhythm per hand means the first one gives way.
    const midi = build([
      track([
        { at: 0, ticks: TPQ * 4, midi: 60 },
        { at: TPQ, ticks: TPQ, midi: 62 },
      ]),
    ]);
    const { measures } = read(midi);
    assert.deepEqual(shape(measures[0]!.staves[0]), ['nq', 'nq', 'rh']);
  });
});

describe('deciding which hand plays what', () => {
  const rightThenLeft = [
    { at: 0, ticks: TPQ, midi: 72 },
    { at: TPQ, ticks: TPQ, midi: 40 },
  ];

  it('takes two tracks as the two hands, lower one left', () => {
    const midi = build([
      track([rightThenLeft[1]!]), // the lower part written first
      track([rightThenLeft[0]!]),
    ]);
    const { score, handsFrom } = read(midi);
    assert.equal(handsFrom, 'tracks');
    assert.deepEqual(
      score.events.map((e) => [e.notes[0]!.midi, e.notes[0]!.staff]),
      [
        [72, 1],
        [40, 2],
      ],
    );
  });

  it('takes two channels as the two hands when there is only one track', () => {
    const midi = build([
      track([
        { ...rightThenLeft[0]!, channel: 0 },
        { ...rightThenLeft[1]!, channel: 1 },
      ]),
    ]);
    const { score, handsFrom } = read(midi);
    assert.equal(handsFrom, 'channels');
    assert.deepEqual(
      score.events.map((e) => e.notes[0]!.staff),
      [1, 2],
    );
  });

  it('splits by pitch when the file says nothing, at middle C or where asked', () => {
    const midi = build([track(rightThenLeft)]);
    const plain = read(midi);
    assert.equal(plain.handsFrom, 'split');
    assert.deepEqual(
      plain.score.events.map((e) => e.notes[0]!.staff),
      [1, 2],
    );
    const high = read(midi, { splitPoint: 84 });
    assert.deepEqual(
      high.score.events.map((e) => e.notes[0]!.staff),
      [2, 2],
      'everything below the split is the left hand',
    );
  });

  it('leaves percussion out', () => {
    const midi = build([
      track([
        { at: 0, ticks: TPQ, midi: 60 },
        { at: 0, ticks: TPQ, midi: 38, channel: 9 },
      ]),
    ]);
    const { score } = read(midi);
    assert.deepEqual(
      score.events.flatMap((e) => e.notes.map((n) => n.midi)),
      [60],
    );
  });
});
