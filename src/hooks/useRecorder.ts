import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MidiFileError, parseMidiFile } from '../core/midi/midiFile.ts';
import {
  EMPTY_RECORDING,
  endRecording,
  fitTempo,
  recordEvent,
  recordedLengthMs,
  recordingToMidi,
  type RecorderState,
} from '../core/midi/recording.ts';
import type { MidiEvent } from '../core/midi/types.ts';
import { scoreFromMidi, type MidiScore } from '../core/score/midiScore.ts';

export type RecorderPhase = 'idle' | 'recording' | 'done';

export interface Take {
  /** The recording as a file: what is saved, and what is downloaded. */
  readonly midi: Uint8Array;
  /** The same thing read back and engraved. */
  readonly score: MidiScore;
  readonly noteCount: number;
  readonly lengthMs: number;
}

export interface Recorder {
  readonly phase: RecorderPhase;
  /** Notes captured so far, for the live count. */
  readonly noteCount: number;
  /** Milliseconds recorded so far, updated a few times a second. */
  readonly elapsedMs: number;
  /** The tempo the take is written at; changing it rewrites the notation. */
  readonly tempoBpm: number;
  /** The tempo the playing was found to be in, and the default. */
  readonly fittedBpm: number;
  /** True while the fitted tempo is the one in use. */
  readonly tempoIsFitted: boolean;
  /** Null until a take has been stopped, and null if nothing was played. */
  readonly take: Take | null;
  /** Set when a stopped recording could not be made into a score. */
  readonly problem: string | null;
  start(): void;
  stop(): void;
  discard(): void;
  setTempoBpm(bpm: number): void;
  /** Feed a MIDI event in. Ignored unless a recording is running. */
  handleMidi(event: MidiEvent): void;
}

/**
 * A long take is fine; an endless one is not. Ten minutes at a sensible
 * tempo is a few hundred bars — beyond that, engraving it would take longer
 * than playing it did.
 */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

const DEFAULT_TEMPO = 90;

/**
 * Free play, remembered.
 *
 * The capture itself is a pure fold (core/midi/recording.ts); this holds it
 * in React, ticks a clock while it runs, and turns a finished take into a
 * MIDI file and an engraved score. Making the file first and reading it
 * back may look roundabout, but it is the point: what you see is what will
 * be saved, read by the same code that reads any other MIDI file.
 */
export function useRecorder(): Recorder {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [state, setState] = useState<RecorderState>(EMPTY_RECORDING);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Null means "whatever the playing was in": the take is written at the
  // tempo it was found to be in until you say otherwise.
  const [chosenBpm, setChosenBpm] = useState<number | null>(null);
  // Read inside the MIDI callback, which must not be re-created on every
  // captured note: re-subscribing mid-chord drops the rest of the chord.
  const phaseRef = useRef<RecorderPhase>('idle');
  phaseRef.current = phase;
  const stateRef = useRef(state);
  stateRef.current = state;

  const start = useCallback(() => {
    setState(EMPTY_RECORDING);
    setElapsedMs(0);
    setChosenBpm(null);
    setPhase('recording');
  }, []);

  const stop = useCallback(() => {
    setState((previous) => endRecording(previous, performance.now()));
    setPhase((previous) => (previous === 'recording' ? 'done' : previous));
  }, []);

  const discard = useCallback(() => {
    setState(EMPTY_RECORDING);
    setElapsedMs(0);
    setChosenBpm(null);
    setPhase('idle');
  }, []);

  const handleMidi = useCallback((event: MidiEvent) => {
    if (phaseRef.current !== 'recording') return;
    const at = performance.now();
    setState((previous) => recordEvent(previous, event, at));
  }, []);

  // The running clock. Four times a second is enough for a counter that
  // shows seconds, and cheap enough not to matter.
  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = () => setElapsedMs(recordedLengthMs(stateRef.current, performance.now()));
    const timer = setInterval(tick, 250);
    tick();
    return () => clearInterval(timer);
  }, [phase]);

  // Stop by itself rather than record for ever.
  useEffect(() => {
    if (phase === 'recording' && elapsedMs >= MAX_RECORDING_MS) stop();
  }, [phase, elapsedMs, stop]);

  const fittedBpm = useMemo(
    () => (phase === 'done' && state.notes.length > 0 ? fitTempo(state.notes) : DEFAULT_TEMPO),
    [phase, state.notes],
  );
  const tempoBpm = chosenBpm ?? fittedBpm;

  const [take, problem] = useMemo<[Take | null, string | null]>(() => {
    if (phase !== 'done' || state.notes.length === 0) return [null, null];
    try {
      const midi = recordingToMidi(state.notes, { title: 'Free play', tempoBpm });
      const score = scoreFromMidi(parseMidiFile(midi), { title: 'Free play' });
      return [
        { midi, score, noteCount: state.notes.length, lengthMs: state.lengthMs },
        null,
      ];
    } catch (cause) {
      return [
        null,
        cause instanceof MidiFileError
          ? cause.message
          : `The recording could not be written out: ${cause instanceof Error ? cause.message : String(cause)}`,
      ];
    }
  }, [phase, state.notes, state.lengthMs, tempoBpm]);

  return {
    phase,
    noteCount: state.notes.length + state.held.size,
    elapsedMs,
    tempoBpm,
    fittedBpm,
    tempoIsFitted: chosenBpm === null,
    take,
    problem,
    start,
    stop,
    discard,
    setTempoBpm: setChosenBpm,
    handleMidi,
  };
}
