/**
 * Recording free play.
 *
 * Two jobs, both pure: fold a stream of key presses and releases into
 * finished notes, and write those notes out as a standard MIDI file with
 * their real timing. Everything after that — engraving it, keeping it,
 * practising against it — is the MIDI path the app already has, so a take
 * is not a special kind of thing: it is a MIDI file you happened to make
 * yourself.
 *
 * What is recorded is what your fingers did. The sustain pedal is left out
 * on purpose: pedalled playing would come out as a page of overlapping
 * long notes tied together, which is a fair record of the sound and a poor
 * record of the playing. The pedal is still shown live while you play.
 */

import type { MidiEvent } from './types.ts';
import { conductorTrack, header, noteTrack, TICKS_PER_QUARTER, type NoteEvent } from './writeMidi.ts';

export interface RecordedNote {
  readonly midi: number;
  /** Milliseconds from the first note of the take. */
  readonly startMs: number;
  readonly durationMs: number;
  readonly velocity: number;
}

export interface RecorderState {
  /** Keys down now: pitch to when it was struck and how hard. */
  readonly held: ReadonlyMap<number, { at: number; velocity: number }>;
  readonly notes: readonly RecordedNote[];
  /** When the first note landed; null until something is played. */
  readonly startedAt: number | null;
  /** The end of the last note to finish, in milliseconds from the start. */
  readonly lengthMs: number;
}

export const EMPTY_RECORDING: RecorderState = {
  held: new Map(),
  notes: [],
  startedAt: null,
  lengthMs: 0,
};

/** Anything shorter than this is a brush against a key, not a note. */
const SHORTEST_MS = 20;

/**
 * Fold one event in. `at` is a reading of the same clock throughout —
 * `performance.now()` in the app, plain numbers in tests.
 */
export function recordEvent(state: RecorderState, event: MidiEvent, at: number): RecorderState {
  if (event.type === 'noteon' && event.velocity > 0) {
    const held = new Map(state.held);
    // A second press of a key already down means the first release went
    // missing; the newer press is the one to keep.
    held.set(event.note, { at, velocity: event.velocity });
    return { ...state, held, startedAt: state.startedAt ?? at };
  }

  if (event.type === 'noteoff' || (event.type === 'noteon' && event.velocity === 0)) {
    return release(state, event.note, at);
  }

  if (event.type === 'allnotesoff') {
    let next = state;
    for (const note of state.held.keys()) next = release(next, note, at);
    return next;
  }

  // Sustain: deliberately not recorded. See the note at the top.
  return state;
}

function release(state: RecorderState, midi: number, at: number): RecorderState {
  const started = state.held.get(midi);
  if (!started) return state;
  const held = new Map(state.held);
  held.delete(midi);
  const startMs = started.at - (state.startedAt ?? started.at);
  const durationMs = Math.max(SHORTEST_MS, at - started.at);
  return {
    ...state,
    held,
    notes: [...state.notes, { midi, startMs, durationMs, velocity: started.velocity }],
    lengthMs: Math.max(state.lengthMs, startMs + durationMs),
  };
}

/** Close anything still held down, so stopping mid-chord keeps the chord. */
export function endRecording(state: RecorderState, at: number): RecorderState {
  let next = state;
  for (const note of state.held.keys()) next = release(next, note, at);
  return { ...next, notes: [...next.notes].sort((a, b) => a.startMs - b.startMs || a.midi - b.midi) };
}

/** How long the take runs, in milliseconds, counting from its first note. */
export function recordedLengthMs(state: RecorderState, now: number): number {
  const open = [...state.held.values()].reduce(
    (max, held) => Math.max(max, now - (state.startedAt ?? held.at)),
    0,
  );
  return Math.max(state.lengthMs, open);
}

/** Notes struck within this of each other are one chord, not two moments. */
const CHORD_MS = 60;

/**
 * How much of the gap to the next note may be silence before the silence is
 * taken to be meant. Nobody holds a key for its full written value: played
 * literally, an ordinary line of quarter notes comes out as dotted eighths
 * separated by sixteenth rests, which is an accurate record of the fingers
 * and an unreadable piece of music. A quarter of the beat is about where a
 * gap stops being the way a hand works and starts being a rest you played.
 */
const MEANT_AS_SILENCE = 0.4;

/**
 * Write each note as lasting until the next one, where the gap between them
 * is too small to have been meant.
 *
 * Only ever lengthens: a note still sounding when the next arrives — a held
 * bass under a moving line — is left exactly as it was played, and a real
 * staccato keeps its rest.
 */
export function joinUpNotes(
  notes: readonly RecordedNote[],
  gapFraction = MEANT_AS_SILENCE,
): RecordedNote[] {
  const starts = moments(notes);

  return notes.map((note) => {
    const next = starts.find((moment) => moment > note.startMs + CHORD_MS);
    if (next === undefined) return note;
    const end = note.startMs + note.durationMs;
    if (end >= next) return note; // still sounding when the next note lands
    if (next - end > gapFraction * (next - note.startMs)) return note; // a rest
    return { ...note, durationMs: next - note.startMs };
  });
}

/** The slowest and fastest a take is assumed to have been played at. */
const SLOWEST = 40;
const FASTEST = 180;
/** A tempo no worse than this much of a sixteenth counts as just as good. */
const AS_GOOD_AS = 0.015;
/** Tempos are judged as simple notation, not as speed; this is the middle. */
const ORDINARY = 90;

/** The moments of a take: a chord is one of them, not three. */
function moments(notes: readonly RecordedNote[]): number[] {
  const out: number[] = [];
  for (const start of [...notes.map((n) => n.startMs)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || start - last > CHORD_MS) out.push(start);
  }
  return out;
}

/**
 * The tempo the take is most nearly in.
 *
 * Nothing was played to a click, so the written tempo is a choice — but it
 * is not an arbitrary one. Onsets are rounded to sixteenths when the music
 * is engraved, so the tempo that makes them land nearest the sixteenths is
 * the one that writes down what was played; get it wrong and a plain line
 * of quarter notes comes out as a page of syncopation.
 *
 * Half and double a tempo fit exactly as well as the tempo itself — the
 * same playing written in eighths or in halves — so among the tempos that
 * fit, the one nearest an ordinary 90 wins, which is the one that writes
 * the music with the plainest note values.
 */
export function fitTempo(notes: readonly RecordedNote[]): number {
  const onsets = moments(notes);
  if (onsets.length < 3) return ORDINARY;

  // Landing on the sixteenths is not enough on its own: a note every three
  // sixteenths lands on the grid perfectly and is a wretched way to write a
  // steady pulse. So a tempo is also judged on where its notes land — on
  // beats, on half-beats, or between them — which is what picks out the
  // beat rather than some subdivision of it.
  const OFF_THE_BEAT = 0.06;
  const BETWEEN_THE_HALVES = 0.15;

  const misfit = (bpm: number): number => {
    const perSixteenth = 60_000 / bpm / 4;
    let total = 0;
    for (const onset of onsets) {
      const sixteenths = onset / perSixteenth;
      const nearest = Math.round(sixteenths);
      total += Math.abs(sixteenths - nearest);
      if (nearest % 4 !== 0) total += nearest % 2 === 0 ? OFF_THE_BEAT : BETWEEN_THE_HALVES;
    }
    return total / onsets.length;
  };

  // Half and double a tempo fit exactly as well as the tempo itself — the
  // same playing written in eighths, or in half notes. Among those, the one
  // to write is the one where a typical step from note to note is about one
  // beat, because that is the reading in plain quarter notes.
  const gaps = onsets.slice(1).map((onset, i) => onset - onsets[i]!);
  const typicalGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  const awkwardness = (bpm: number): number => {
    if (typicalGap <= 0) return Math.abs(Math.log(bpm / ORDINARY));
    const beats = typicalGap / (60_000 / bpm);
    return Math.abs(Math.log(beats)) + Math.abs(Math.log(bpm / ORDINARY)) / 100;
  };

  const scored = [];
  for (let bpm = SLOWEST; bpm <= FASTEST; bpm++) scored.push({ bpm, misfit: misfit(bpm) });
  const best = scored.reduce((a, b) => (b.misfit < a.misfit ? b : a));
  const closeEnough = scored.filter((candidate) => candidate.misfit <= best.misfit + AS_GOOD_AS);
  return closeEnough.reduce((a, b) => (awkwardness(b.bpm) < awkwardness(a.bpm) ? b : a)).bpm;
}

export interface RecordingMidiOptions {
  readonly title?: string;
  /**
   * The tempo the take is *written* at. Nothing was played to a click, so
   * this is a choice, not a measurement: it decides whether what you played
   * is written as quarters or as eighths.
   */
  readonly tempoBpm?: number;
  /**
   * Write notes as lasting until the next one where the gap is too small to
   * have been meant. On by default — see {@link joinUpNotes} for why.
   */
  readonly joinUp?: boolean;
}

/**
 * The take as a standard MIDI file.
 *
 * One track of notes, not two: free play has no hands marked, and the
 * reader splits a single-track file by pitch — with a control to move the
 * split — rather than guessing here and being stuck with it.
 */
export function recordingToMidi(
  notes: readonly RecordedNote[],
  options: RecordingMidiOptions = {},
): Uint8Array {
  const { title = 'Free play', tempoBpm = 90, joinUp = true } = options;
  const written = joinUp ? joinUpNotes(notes) : notes;
  const ticksPerMs = (Math.max(1, tempoBpm) / 60_000) * TICKS_PER_QUARTER;
  const events: NoteEvent[] = [];
  for (const note of written) {
    const start = Math.round(note.startMs * ticksPerMs);
    events.push({ tick: start, on: true, midi: note.midi, velocity: note.velocity });
    events.push({
      tick: Math.max(start + 1, Math.round((note.startMs + note.durationMs) * ticksPerMs)),
      on: false,
      midi: note.midi,
      velocity: 0,
    });
  }

  return Uint8Array.from([
    ...header(2),
    ...conductorTrack({
      title,
      comment: 'clefcraft: recorded in free play, written out at the tempo shown.',
      tempoBpm,
    }),
    ...noteTrack(events, { name: 'Piano', channel: 0 }),
  ]);
}
