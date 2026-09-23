import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_RECORDING,
  endRecording,
  fitTempo,
  joinUpNotes,
  recordEvent,
  recordedLengthMs,
  recordingToMidi,
  type RecorderState,
} from './recording.ts';
import { parseMidiFile } from './midiFile.ts';
import type { MidiEvent } from './types.ts';
import { scoreFromMidi } from '../score/midiScore.ts';

const on = (note: number, velocity = 80): MidiEvent => ({
  type: 'noteon',
  note,
  velocity,
  channel: 0,
  time: 0,
});
const off = (note: number): MidiEvent => ({
  type: 'noteoff',
  note,
  velocity: 0,
  channel: 0,
  time: 0,
});

/** Play a script of [event, clock] pairs into a fresh recording. */
function play(script: readonly (readonly [MidiEvent, number])[]): RecorderState {
  let state = EMPTY_RECORDING;
  for (const [event, at] of script) state = recordEvent(state, event, at);
  return state;
}

describe('recording what was played', () => {
  it('pairs each release with its press, and times from the first note', () => {
    // The clock starts at 5000: the take must not begin with five seconds
    // of rest just because the button was pressed earlier.
    const state = endRecording(
      play([
        [on(60), 5000],
        [off(60), 5500],
        [on(64), 6000],
        [off(64), 6250],
      ]),
      6300,
    );
    assert.deepEqual(
      state.notes.map((n) => [n.midi, n.startMs, n.durationMs]),
      [
        [60, 0, 500],
        [64, 1000, 250],
      ],
    );
    assert.equal(state.lengthMs, 1250);
  });

  it('keeps a chord as notes that start together', () => {
    const state = endRecording(
      play([
        [on(60), 0],
        [on(64), 8],
        [on(67), 12],
        [off(64), 500],
        [off(60), 505],
        [off(67), 520],
      ]),
      600,
    );
    assert.deepEqual(
      state.notes.map((n) => n.midi),
      [60, 64, 67],
    );
    assert.deepEqual(
      state.notes.map((n) => n.startMs),
      [0, 8, 12],
    );
  });

  it('keeps the velocity of each note', () => {
    const state = endRecording(play([[on(60, 112), 0], [off(60), 200]]), 200);
    assert.equal(state.notes[0]!.velocity, 112);
  });

  it('closes notes still held when the recording stops', () => {
    const state = endRecording(play([[on(60), 0], [on(67), 100]]), 900);
    assert.equal(state.held.size, 0);
    assert.deepEqual(
      state.notes.map((n) => [n.midi, n.startMs, n.durationMs]),
      [
        [60, 0, 900],
        [67, 100, 800],
      ],
    );
  });

  it('treats a note-on of velocity 0 as a release, as instruments do', () => {
    const state = endRecording(play([[on(60), 0], [on(60, 0), 400]]), 400);
    assert.deepEqual(
      state.notes.map((n) => [n.midi, n.durationMs]),
      [[60, 400]],
    );
  });

  it('gives a brushed key a length it can be written with', () => {
    const state = endRecording(play([[on(60), 0], [off(60), 1]]), 10);
    assert.ok(state.notes[0]!.durationMs >= 20);
  });

  it('leaves the sustain pedal out of the take', () => {
    const state = endRecording(
      play([
        [{ type: 'sustain', down: true, channel: 0, time: 0 }, 0],
        [on(60), 100],
        [off(60), 200],
        [{ type: 'sustain', down: false, channel: 0, time: 0 }, 900],
      ]),
      900,
    );
    assert.deepEqual(
      state.notes.map((n) => [n.midi, n.durationMs]),
      [[60, 100]],
      'the key was down for 100ms, whatever the pedal was doing',
    );
  });

  it('lets go of everything on an all-notes-off', () => {
    const state = play([
      [on(60), 0],
      [on(64), 0],
      [{ type: 'allnotesoff', channel: 0, time: 0 }, 300],
    ]);
    assert.equal(state.held.size, 0);
    assert.equal(state.notes.length, 2);
  });

  it('reports how long it has been running, held notes included', () => {
    assert.equal(recordedLengthMs(EMPTY_RECORDING, 1000), 0, 'nothing played yet is no length');
    const playing = play([[on(60), 1000]]);
    assert.equal(recordedLengthMs(playing, 3000), 2000);
    const done = endRecording(playing, 3000);
    assert.equal(recordedLengthMs(done, 9999), 2000, 'and it stops growing once stopped');
  });
});

describe('writing what was played as something readable', () => {
  const note = (midi: number, startMs: number, durationMs: number) => ({
    midi,
    startMs,
    durationMs,
    velocity: 80,
  });

  it('writes a note let go just before the next one as lasting until it', () => {
    // Four quarters at 90bpm, each key held for three quarters of its beat:
    // ordinary playing, which written literally is dotted eighths and rests.
    const played = [0, 667, 1334, 2001].map((at, i) => note(60 + i, at, 500));
    assert.deepEqual(
      joinUpNotes(played).map((n) => n.durationMs),
      [667, 667, 667, 500],
      'the last note has nothing to reach towards, so it keeps its own length',
    );
  });

  it('leaves a real rest alone', () => {
    const played = [note(60, 0, 150), note(62, 667, 500)];
    assert.equal(joinUpNotes(played)[0]!.durationMs, 150, 'a staccato note stays short');
  });

  it('never shortens a note still sounding when the next one lands', () => {
    // A held bass under a moving right hand.
    const played = [note(48, 0, 2600), note(72, 667, 600), note(74, 1334, 600)];
    assert.equal(joinUpNotes(played)[0]!.durationMs, 2600);
  });

  it('measures the gap from the next chord, not from the rest of this one', () => {
    const played = [note(60, 0, 500), note(64, 9, 500), note(67, 14, 500), note(72, 667, 500)];
    assert.deepEqual(
      joinUpNotes(played).map((n) => n.durationMs),
      [667, 658, 653, 500],
      'every note of the chord reaches the next chord',
    );
  });

  it('comes out as plain quarter notes once joined up', () => {
    const played = [0, 667, 1334, 2001].map((at, i) => note(60 + i, at, 500));
    const { measures } = scoreFromMidi(parseMidiFile(recordingToMidi(played, { tempoBpm: 90 })));
    assert.deepEqual(
      measures[0]!.staves[0].map((e) => `${e.rest ? 'r' : 'n'}${e.duration}${'.'.repeat(e.dots)}`),
      ['nq', 'nq', 'nq', 'n8.', 'r16'],
      'the last note is written as long as it was held: nothing follows it to join up to',
    );
  });

  it('is left alone when the joining is turned off', () => {
    const played = [0, 667].map((at, i) => note(60 + i, at, 500));
    const file = parseMidiFile(recordingToMidi(played, { tempoBpm: 90, joinUp: false }));
    assert.equal(file.notes[0]!.durationTicks, 360, 'three quarters of a beat, as played');
  });
});

describe('finding the tempo a take was played in', () => {
  const at = (times: readonly number[]) =>
    times.map((startMs, i) => ({ midi: 60 + (i % 5), startMs, durationMs: 300, velocity: 80 }));
  const every = (ms: number, count: number) =>
    at(Array.from({ length: count }, (_, i) => Math.round(i * ms)));

  it('finds the beat of steady playing', () => {
    assert.equal(fitTempo(every(667, 8)), 90, 'a note every 667ms is 90 quarters a minute');
    assert.equal(fitTempo(every(500, 8)), 120);
    assert.equal(fitTempo(every(1000, 8)), 60);
  });

  it('writes the plainest of the tempos that fit equally well', () => {
    // 45, 90 and 180 all fit a note every 667ms exactly — as eighths, as
    // quarters and as half notes. The one that writes it in quarters wins.
    assert.equal(fitTempo(every(667, 8)), 90);
    assert.equal(fitTempo(every(1333, 6)), 45, 'and slow playing is not written as fast eighths');
  });

  it('is not fooled by a pulse that lands on the grid awkwardly', () => {
    // A note every 500ms lands exactly on the sixteenths at 90bpm too —
    // three of them — which would write a steady pulse as dotted eighths.
    assert.equal(fitTempo(every(500, 8)), 120);
  });

  it('survives playing that is not quite even', () => {
    const wobbly = at([0, 655, 1350, 2000, 2660, 3320, 4010, 4660]);
    const fitted = fitTempo(wobbly);
    assert.ok(Math.abs(fitted - 90) <= 3, `close to 90, got ${fitted}`);
  });

  it('follows a mixture of note lengths, not just the fastest', () => {
    // Quarter, quarter, two eighths, quarter at 100bpm (600ms a beat).
    assert.equal(fitTempo(at([0, 600, 1200, 1500, 1800])), 100);
  });

  it('says nothing much from one or two notes', () => {
    assert.equal(fitTempo(at([0])), 90);
    assert.equal(fitTempo(at([0, 700])), 90, 'two notes fit any tempo; do not pretend otherwise');
  });

  it('writes a chord as one moment, not three', () => {
    const rolled = [0, 8, 14, 667, 672, 1334, 2001, 2668].map((startMs, i) => ({
      midi: 60 + i,
      startMs,
      durationMs: 300,
      velocity: 80,
    }));
    assert.equal(fitTempo(rolled), 90, 'the few milliseconds inside a chord are not a beat');
  });

  it('is what makes uneven playing readable', () => {
    // Six notes about 550ms apart, each held most of its beat: at 90bpm
    // they land between the sixteenths and come out as syncopation.
    const played = Array.from({ length: 6 }, (_, i) => ({
      midi: 60 + i,
      startMs: i * 550,
      durationMs: 450,
      velocity: 80,
    }));
    const asWritten = (bpm: number) =>
      scoreFromMidi(parseMidiFile(recordingToMidi(played, { tempoBpm: bpm })))
        .measures.flatMap((m) => m.staves[0])
        .map((e) => `${e.rest ? 'r' : 'n'}${e.duration}${'.'.repeat(e.dots)}`);
    const fitted = fitTempo(played);
    assert.equal(fitted, 109);
    assert.deepEqual(
      asWritten(fitted).filter((written) => written.startsWith('n')),
      ['nq', 'nq', 'nq', 'nq', 'nq', 'n8.'],
      'plain quarters, and the last note as long as it was held',
    );
    assert.ok(
      asWritten(90).some((written) => written === 'n16' || written === 'r16'),
      'at the wrong tempo the same playing is written in sixteenths',
    );
  });
});

describe('writing a take out as MIDI', () => {
  const take = endRecording(
    play([
      [on(60, 90), 0],
      [off(60), 660], // a quarter at 90bpm is 667ms
      [on(62), 667],
      [off(62), 1000],
      [on(64), 1333],
      [on(55), 1333],
      [off(64), 2000],
      [off(55), 2000],
    ]),
    2000,
  );

  it('reads back with the timing it was played at', () => {
    const file = parseMidiFile(recordingToMidi(take.notes, { tempoBpm: 90, title: 'Take 1' }));
    assert.equal(file.title, 'Take 1');
    assert.equal(file.ticksPerQuarter, 480);
    assert.equal(file.tempos[0]?.microsPerQuarter, Math.round(60_000_000 / 90));
    assert.deepEqual(
      file.notes.map((n) => [n.midi, n.startTicks]),
      [
        [60, 0],
        [62, 480],
        [55, 960],
        [64, 960],
      ],
      'a quarter apart at the tempo it is written at',
    );
  });

  it('is engraved as the notes that were played', () => {
    const { score, measures, handsFrom } = scoreFromMidi(
      parseMidiFile(recordingToMidi(take.notes, { tempoBpm: 90 })),
      { title: 'Take 1' },
    );
    assert.equal(handsFrom, 'split', 'free play marks no hands, so the reader splits by pitch');
    assert.deepEqual(
      score.events.map((e) => e.notes.map((n) => n.midi)),
      [[60], [62], [64, 55]],
    );
    assert.equal(measures.length, 1, 'three quarters and a bit of silence is one bar');
    assert.equal(score.tempoBpm, 90);
  });

  it('writes the same playing differently at a different tempo', () => {
    // The same take called 45bpm: every note is worth twice as much.
    const slow = parseMidiFile(recordingToMidi(take.notes, { tempoBpm: 45 }));
    assert.deepEqual(
      slow.notes.map((n) => n.startTicks),
      [0, 240, 480, 480],
    );
    assert.equal(
      scoreFromMidi(slow).measures.length,
      1,
      'and the whole take now fits in half the music',
    );
  });

  it('never writes a note of no length', () => {
    const flick = endRecording(play([[on(60), 0], [off(60), 1]]), 1);
    const file = parseMidiFile(recordingToMidi(flick.notes, { tempoBpm: 240 }));
    assert.ok(file.notes[0]!.durationTicks >= 1);
  });
});
