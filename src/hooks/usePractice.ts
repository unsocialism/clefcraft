import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MidiEvent, RawMidiMessage } from '../core/midi/types.ts';
import type { EventOrigin } from './usePianoInput.ts';
import {
  DEFAULT_PRACTICE_OPTIONS,
  advanceToTime,
  attemptExpiresIn,
  expireAttempt,
  currentEvent,
  pressNote,
  scoreLengthQuarters,
  seekToMeasure,
  seekToIndex,
  startPractice,
  upcoming,
  type PracticeMode,
  type PracticeState,
} from '../core/score/practiceEngine.ts';
import { EMPTY_SCORE, type Score } from '../core/score/types.ts';

/** A note-on exactly as it arrived, before the engine judged it. */
export interface Arrival {
  readonly midi: number;
  readonly channel: number;
  readonly portId: string | null;
  readonly at: number;
}

export interface PracticeSession {
  readonly score: Score;
  readonly state: PracticeState;
  readonly mode: PracticeMode;
  readonly requireClean: boolean;
  /** Null when chords may be rolled out at any speed. */
  readonly chordWindowMs: number | null;
  readonly tempoBpm: number;
  readonly running: boolean;
  /** Current event plus lookahead, for the keyboard strip. */
  readonly ahead: ReturnType<typeof upcoming>;
  readonly progress: number;
  /** Raw note-ons, newest first — transport-level, for diagnosing duplicates. */
  readonly arrivals: readonly Arrival[];
  /**
   * Drop a repeat of the same note from the same port within this many
   * milliseconds, or null to accept everything. A workaround for instruments
   * that deliver each key press twice.
   */
  readonly ignoreDuplicatesMs: number | null;
  /** Raw messages off the wire, newest first. */
  readonly rawMessages: readonly RawMidiMessage[];

  /**
   * Load a score. `keepPosition` holds your place instead of rewinding —
   * used when the same piece is rebuilt after a note was corrected, where
   * jumping back to the first bar would punish you for fixing it.
   */
  setScore(score: Score, options?: { keepPosition?: boolean }): void;
  setMode(mode: PracticeMode): void;
  setRequireClean(value: boolean): void;
  setChordWindowMs(ms: number | null): void;
  setIgnoreDuplicatesMs(ms: number | null): void;
  setTempoBpm(bpm: number): void;
  start(): void;
  pause(): void;
  restart(): void;
  seekMeasure(measure: number): void;
  /** Feed a MIDI event in; only note-ons affect practice. */
  handleMidi(event: MidiEvent, origin: EventOrigin, portId: string | null): void;
  handleRawMessage(message: RawMidiMessage): void;
}

const LOOKAHEAD = 3;

/**
 * Default chord timing window. 120ms is comfortably wider than the spread of
 * a deliberately played chord and comfortably narrower than an arpeggio.
 */
export const DEFAULT_CHORD_WINDOW_MS = 120;

export function usePractice(): PracticeSession {
  const [score, setScoreState] = useState<Score>(EMPTY_SCORE);
  const [state, setState] = useState<PracticeState>(() => startPractice(EMPTY_SCORE));
  const [mode, setMode] = useState<PracticeMode>('wait');
  const [requireClean, setRequireClean] = useState(false);
  const [chordWindowMs, setChordWindowMs] = useState<number | null>(DEFAULT_CHORD_WINDOW_MS);
  const [tempoBpm, setTempoBpm] = useState(80);
  const [running, setRunning] = useState(false);
  const [arrivals, setArrivals] = useState<readonly Arrival[]>([]);
  const [ignoreDuplicatesMs, setIgnoreDuplicatesMs] = useState<number | null>(null);
  const [rawMessages, setRawMessages] = useState<readonly RawMidiMessage[]>([]);
  // Checked synchronously, so it cannot lag behind a burst of messages the
  // way a state value read during render would.
  const lastArrivalRef = useRef<Arrival | null>(null);
  const ignoreRef = useRef<number | null>(null);
  ignoreRef.current = ignoreDuplicatesMs;

  // The engine is pure, so the latest score and options are read through refs
  // to keep the MIDI callback stable — re-subscribing on every state change
  // would drop events mid-chord.
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const optionsRef = useRef(DEFAULT_PRACTICE_OPTIONS);
  optionsRef.current = { mode, requireClean, chordWindowMs };

  const setScore = useCallback((next: Score, options?: { keepPosition?: boolean }) => {
    setScoreState(next);
    if (options?.keepPosition) {
      setState((previous) =>
        seekToIndex(next, Math.min(previous.index, Math.max(0, next.events.length - 1))),
      );
      return;
    }
    setState(startPractice(next));
    setRunning(false);
    if (next.tempoBpm && next.tempoBpm > 0) setTempoBpm(Math.round(next.tempoBpm));
  }, []);

  const handleMidi = useCallback(
    (event: MidiEvent, origin: EventOrigin = 'device', portId: string | null = null) => {
    if (event.type !== 'noteon') return;

    // One clock for everything, read once, at the moment the message is
    // handled. Reading it inside a state updater instead would timestamp
    // both copies of a doubled press in the same React batch and report the
    // gap between them as 0ms — measuring the renderer, not the instrument.
    const now = performance.now();

    if (origin === 'device') {
      const previous = lastArrivalRef.current;
      const window = ignoreRef.current;
      const isEcho =
        window !== null &&
        previous !== null &&
        previous.midi === event.note &&
        previous.portId === portId &&
        previous.channel === event.channel &&
        now - previous.at < window;
      if (isEcho) return; // a second copy of one key press

      const arrival: Arrival = { midi: event.note, channel: event.channel, portId, at: now };
      lastArrivalRef.current = arrival;
      setArrivals((prior) => [arrival, ...prior].slice(0, 12));
    }
    // Clicks on the on-screen keyboard arrive one at a time by nature, so the
    // chord window is lifted for them rather than making chords unplayable
    // by mouse.
    const options =
      origin === 'virtual'
        ? { ...optionsRef.current, chordWindowMs: null }
        : optionsRef.current;
    // (`now` above is deliberately performance.now() rather than the event's
    // own timestamp.
    // Web MIDI timestamps are supposed to share this clock, but they are not
    // reliably populated across drivers and platforms, and mixing a device
    // timestamp with the clock used for on-screen clicks makes the chord
    // window compare two different epochs — which closes it permanently and
    // silently stops a real instrument advancing at all. The handling delay
    // is a few milliseconds at most, far inside any usable window.)
    setState((previous) => {
      const next = pressNote(scoreRef.current, previous, event.note, options, now);
      // A click bypasses the window, so it must also bypass the expiry timer:
      // leaving an attempt clock running would let the timer discard progress
      // the window itself was never going to reject.
      return origin === 'virtual' ? { ...next, chordStartedAt: null } : next;
    });
  }, []);

  const handleRawMessage = useCallback((message: RawMidiMessage) => {
    setRawMessages((previous) => [message, ...previous].slice(0, 16));
  }, []);

  const restart = useCallback(() => {
    setState(startPractice(scoreRef.current));
    setRunning(false);
    setArrivals([]);
    setRawMessages([]);
    lastArrivalRef.current = null;
  }, []);

  const seekMeasure = useCallback((measure: number) => {
    setState(seekToMeasure(scoreRef.current, measure));
  }, []);

  const start = useCallback(() => setRunning(true), []);
  const pause = useCallback(() => setRunning(false), []);

  // Tempo mode clock. Driven by requestAnimationFrame against wall time so a
  // dropped frame does not slow the piece down.
  useEffect(() => {
    if (!running || mode !== 'tempo') return;
    if (score.events.length === 0) return;

    const quartersPerMs = tempoBpm / 60 / 1000;
    const startEvent = currentEvent(score, state);
    const startQuarters = startEvent?.onsetQuarters ?? 0;
    const startedAt = performance.now();
    let frame = 0;

    const tick = () => {
      const elapsed = (performance.now() - startedAt) * quartersPerMs;
      const at = startQuarters + elapsed;
      setState((previous) => advanceToTime(scoreRef.current, previous, at));
      if (at >= scoreLengthQuarters(scoreRef.current)) {
        setRunning(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `state` is intentionally not a dependency: the clock reads its start
    // point once and then owns the cursor until paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, tempoBpm, score]);

  // Abandon a half-played chord once its window closes. Without this the
  // partial attempt never expires on its own: the keys already pressed stay
  // hidden from the guide until some later keypress happens to reset it.
  useEffect(() => {
    const delay = attemptExpiresIn(state, optionsRef.current, performance.now());
    if (delay === null) return;
    const timer = setTimeout(() => setState(expireAttempt), delay + 1);
    return () => clearTimeout(timer);
  }, [state, chordWindowMs]);

  const ahead = useMemo(() => upcoming(score, state, LOOKAHEAD), [score, state]);

  const progress = useMemo(() => {
    if (score.events.length === 0) return 0;
    if (state.finished) return 1;
    return state.index / score.events.length;
  }, [score, state]);

  return {
    score,
    state,
    mode,
    requireClean,
    chordWindowMs,
    tempoBpm,
    running,
    ahead,
    progress,
    arrivals,
    ignoreDuplicatesMs,
    rawMessages,
    setScore,
    setMode,
    setRequireClean,
    setChordWindowMs,
    setIgnoreDuplicatesMs,
    setTempoBpm,
    start,
    pause,
    restart,
    seekMeasure,
    handleMidi,
    handleRawMessage,
  };
}
