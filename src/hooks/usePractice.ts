import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MidiEvent, RawMidiMessage } from '../core/midi/types.ts';
import type { EventOrigin } from './usePianoInput.ts';
import {
  CLOCK_IDLE,
  beatQuartersFor,
  countInQuartersFor,
  readClock,
  type ClockReading,
} from '../core/score/clock.ts';
import {
  DEFAULT_PRACTICE_OPTIONS,
  advanceToTime,
  attemptExpiresIn,
  expireAttempt,
  currentEvent,
  measureRange,
  pressNote,
  scoreLengthQuarters,
  seekToMeasure,
  seekToIndex,
  startPractice,
  stepUpTempo,
  upcoming,
  type MeasureRange,
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
  /** Beats in a bar and what a beat is worth, for the count-in and the pulse. */
  readonly meter: Meter;
  /** The section being repeated, or null when the whole piece is in play. */
  readonly loop: LoopSettings | null;
  /** The loop as events and time, or null when nothing falls in it. */
  readonly loopRange: MeasureRange | null;
  readonly loopProgress: LoopProgress;
  /**
   * The play-along clock, updated every frame while it runs. A ref rather
   * than state on purpose: a line that sweeps across the page has to move
   * sixty times a second, and re-rendering the app that often to move it
   * would cost far more than moving it does.
   */
  readonly clock: { readonly current: ClockReading };
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
  setMeter(meter: Meter): void;
  /**
   * Set or clear the section to repeat. Setting one moves the cursor to its
   * first note and starts the count of passes again.
   */
  setLoop(loop: LoopSettings | null): void;
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
 * A section set to repeat, and how to repeat it.
 *
 * Bar numbers rather than events, because a section is something you read
 * off the page: "bars nine to sixteen" is how you would say it to a teacher,
 * and it means the same whichever file the music came from.
 */
export interface LoopSettings {
  readonly fromMeasure: number;
  readonly toMeasure: number;
  /** Play along: count a bar in at the top of every pass. */
  readonly countIn: boolean;
  /** Play along: raise the tempo a little after a pass with no mistakes. */
  readonly speedUp: boolean;
}

/** How the looping is going, since the section was set. */
export interface LoopProgress {
  readonly passes: number;
  /** Passes played from end to end without a wrong note. */
  readonly clean: number;
}

export interface Meter {
  readonly beats: number;
  /** 4 for quarter-note beats, 8 for eighths, and so on. */
  readonly beatType: number;
}

/** What to assume when nothing says otherwise. */
export const DEFAULT_METER: Meter = { beats: 4, beatType: 4 };

/**
 * Default chord timing window. 120ms is comfortably wider than the spread of
 * a deliberately played chord and comfortably narrower than an arpeggio.
 */
export const DEFAULT_CHORD_WINDOW_MS = 120;

/** Nothing has been round yet. */
const NO_PASSES: LoopProgress = { passes: 0, clean: 0 };

/**
 * As fast as clean passes will ever push a section: the top of the tempo
 * slider, so building up never leaves you somewhere the control cannot
 * reach. Capping it at the piece's own written tempo instead was tried and
 * makes the setting do nothing at all when you are already there, which
 * reads as broken rather than as considerate.
 */
const FASTEST_BUILD_UP = 200;

export function usePractice(): PracticeSession {
  const [score, setScoreState] = useState<Score>(EMPTY_SCORE);
  const [state, setState] = useState<PracticeState>(() => startPractice(EMPTY_SCORE));
  const [mode, setMode] = useState<PracticeMode>('wait');
  const [requireClean, setRequireClean] = useState(false);
  const [chordWindowMs, setChordWindowMs] = useState<number | null>(DEFAULT_CHORD_WINDOW_MS);
  const [tempoBpm, setTempoBpm] = useState(80);
  const [running, setRunning] = useState(false);
  const [meter, setMeter] = useState<Meter>(DEFAULT_METER);
  const [loop, setLoopState] = useState<LoopSettings | null>(null);
  const [loopProgress, setLoopProgress] = useState<LoopProgress>(NO_PASSES);
  const clock = useRef<ClockReading>(CLOCK_IDLE);
  // Set when Play is pressed, and cleared once the count-in it asks for has
  // been given. Changing the tempo while the piece runs restarts the clock
  // effect below, and counting you in again mid-piece would be worse than
  // useless.
  const countInRef = useRef(false);
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
  const stateRef = useRef(state);
  stateRef.current = state;

  // The looped section as events and time. Recomputed when the section or
  // the score changes, and read through a ref by the clock, which owns the
  // cursor while it runs and must not be restarted for it.
  const loopRange = useMemo(
    () => (loop ? measureRange(score, loop.fromMeasure, loop.toMeasure) : null),
    [loop, score],
  );
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const rangeRef = useRef(loopRange);
  rangeRef.current = loopRange;

  const setLoop = useCallback((next: LoopSettings | null) => {
    setLoopState(next);
    setLoopProgress(NO_PASSES);
    if (!next) return;
    const range = measureRange(scoreRef.current, next.fromMeasure, next.toMeasure);
    if (range) setState(seekToIndex(scoreRef.current, range.firstIndex));
  }, []);

  /**
   * A pass is over: count it, reward a clean one, and go back to the top.
   *
   * Called from the clock in tempo mode and from the watcher below in wait
   * mode, so the two modes count the same thing in the same way.
   */
  const turnAround = useCallback(() => {
    const range = rangeRef.current;
    const settings = loopRef.current;
    if (!range) return;
    // Seeking resets the engine's counters, and every pass begins with a
    // seek, so what they hold is this pass and nothing earlier. A pass is
    // clean when it was played — all of its notes — and none of them wrong;
    // without the second half, a section left running while you make tea
    // would count clean passes and, worse, speed itself up.
    const here = stateRef.current;
    const clean = here.totalMistakes === 0 && here.correctNotes >= range.noteCount;
    setLoopProgress((previous) => ({
      passes: previous.passes + 1,
      clean: previous.clean + (clean ? 1 : 0),
    }));
    if (clean && settings?.speedUp) {
      // The tempo change restarts the clock below, which reads this rather
      // than the local run of the pass — so the count-in has to be asked
      // for again here or the new pass would begin without one.
      countInRef.current = settings.countIn;
      setTempoBpm((bpm) => stepUpTempo(bpm, FASTEST_BUILD_UP));
    }
    setState(seekToIndex(scoreRef.current, range.firstIndex));
  }, []);

  const setScore = useCallback((next: Score, options?: { keepPosition?: boolean }) => {
    setScoreState(next);
    if (!options?.keepPosition) {
      // A section of one piece means nothing in the next one.
      setLoopState(null);
      setLoopProgress(NO_PASSES);
    }
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

  const start = useCallback(() => {
    // Starting outside the section you are working on would play up to it
    // and only then begin looping, which is not what the section is for.
    const range = rangeRef.current;
    const here = stateRef.current;
    if (range && (here.finished || here.index < range.firstIndex || here.index > range.lastIndex)) {
      setState(seekToIndex(scoreRef.current, range.firstIndex));
    }
    countInRef.current = true;
    setRunning(true);
  }, []);
  const pause = useCallback(() => setRunning(false), []);

  // Tempo mode clock. Driven by requestAnimationFrame against wall time so a
  // dropped frame does not slow the piece down.
  useEffect(() => {
    if (!running || mode !== 'tempo') {
      clock.current = CLOCK_IDLE;
      return;
    }
    if (score.events.length === 0) return;

    const quartersPerMs = tempoBpm / 60 / 1000;
    const startEvent = currentEvent(score, state);
    const oneBar = countInQuartersFor(meter.beats, meter.beatType);
    const beatQuarters = beatQuartersFor(meter.beatType);
    // Where this pass sets off from, and when. Both move when a looped
    // section comes round again, which is why they are not constants.
    let startQuarters = startEvent?.onsetQuarters ?? 0;
    // A bar of beats before the music moves, so you can come in with it
    // rather than chase it from a standing start.
    let countInQuarters = countInRef.current ? oneBar : 0;
    countInRef.current = false;
    let startedAt = performance.now();
    let frame = 0;
    // Set before the first frame, so nothing reads the clock as idle in the
    // moment between Play and the frame that follows it.
    clock.current = readClock({
      elapsedQuarters: 0,
      startQuarters,
      countInQuarters,
      beatQuarters,
      beatsPerBar: meter.beats,
    });

    const tick = () => {
      const elapsedQuarters = (performance.now() - startedAt) * quartersPerMs;
      const reading = readClock({
        elapsedQuarters,
        startQuarters,
        countInQuarters,
        beatQuarters,
        beatsPerBar: meter.beats,
      });
      clock.current = reading;
      if (!reading.countingIn) {
        const range = rangeRef.current;
        if (range && reading.quarters >= range.endQuarters - 1e-9) {
          // The end of the section: round again from the top, counted in or
          // not as asked. Done here rather than by restarting the effect, so
          // the turn happens on the beat it is due rather than a render later.
          turnAround();
          startQuarters = range.startQuarters;
          countInQuarters = loopRef.current?.countIn ? oneBar : 0;
          startedAt = performance.now();
          frame = requestAnimationFrame(tick);
          return;
        }
        setState((previous) => advanceToTime(scoreRef.current, previous, reading.quarters));
        if (reading.quarters >= scoreLengthQuarters(scoreRef.current)) {
          clock.current = CLOCK_IDLE;
          setRunning(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clock.current = CLOCK_IDLE;
    };
    // `state` is intentionally not a dependency: the clock reads its start
    // point once and then owns the cursor until paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode, tempoBpm, score, meter, turnAround]);

  // Wait mode has no clock to notice the end of a section, so the cursor is
  // watched instead: playing past the last note of the loop turns it round.
  useEffect(() => {
    if (mode !== 'wait' || !loopRange) return;
    if (state.finished || state.index > loopRange.lastIndex) turnAround();
  }, [mode, loopRange, state.index, state.finished, turnAround]);

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
    meter,
    loop,
    loopRange,
    loopProgress,
    clock,
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
    setMeter,
    setLoop,
    start,
    pause,
    restart,
    seekMeasure,
    handleMidi,
    handleRawMessage,
  };
}
