import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MidiEvent } from '../core/midi/types.ts';
import {
  LEVELS,
  generateExercise,
  levelById,
  scoreFromExercise,
  type Exercise,
} from '../core/training/generator.ts';
import type { EventOrigin } from './usePianoInput.ts';
import { DEFAULT_CHORD_WINDOW_MS, usePractice, type PracticeSession } from './usePractice.ts';

const LEVEL_KEY = 'clefcraft.training.level';

/**
 * After an exercise ends, a key pressed within this long is still the tail
 * of the last note rather than a request for the next exercise.
 */
const CONTINUE_AFTER_MS = 1200;

function savedLevel(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(LEVEL_KEY));
    return LEVELS.some((l) => l.id === stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export interface TrainingResult {
  readonly notes: number;
  readonly firstTry: number;
  readonly mistakes: number;
  /** From the first key pressed to the last note, in milliseconds. */
  readonly durationMs: number | null;
}

export interface TrainingSession {
  readonly level: number;
  readonly exercise: Exercise;
  readonly practice: PracticeSession;
  /** Indices of notes that needed more than one try. */
  readonly missed: ReadonlySet<number>;
  readonly result: TrainingResult | null;
  /**
   * On a "together" level, the notes of the current beat were not pressed
   * close enough together, and the beat has started over.
   */
  readonly rolled: boolean;
  setLevel(level: number): void;
  next(): void;
  restart(): void;
  handleMidi(event: MidiEvent, origin: EventOrigin, portId: string | null): void;
}

/**
 * The training tab: a generated exercise, played through the same practice
 * engine as a real score, in its own instance — so switching tabs leaves the
 * piece you were practising exactly where you were in it.
 */
export function useTraining(): TrainingSession {
  const practice = usePractice();
  const { setScore, handleMidi: practiceMidi, restart: practiceRestart } = practice;
  const [level, setLevelState] = useState(savedLevel);
  const [exercise, setExercise] = useState<Exercise>(() =>
    generateExercise({ level: savedLevel(), seed: newSeed() }),
  );
  const [missed, setMissed] = useState<ReadonlySet<number>>(new Set());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const score = useMemo(() => scoreFromExercise(exercise), [exercise]);
  const { setChordWindowMs } = practice;
  const together = levelById(exercise.level).together ?? false;
  useEffect(() => {
    // On the early interval levels the notes may come in any order, as
    // slowly as you like: they are about reading. Only the levels that say
    // "together" use the chord window, at the same setting as Practice.
    setChordWindowMs(together ? DEFAULT_CHORD_WINDOW_MS : null);
  }, [together, setChordWindowMs]);
  useEffect(() => {
    setScore(score);
    setMissed(new Set());
    setStartedAt(null);
    setFinishedAt(null);
  }, [score, setScore]);

  // For one render after a new exercise, the engine still holds the old
  // score (or, at first, an empty one, which counts as finished). Reading
  // its state then would mark the new exercise done before it began.
  const live = practice.score === score;
  const { index, wrongHere, totalMistakes, cleanEvents, recent, struck } = practice.state;
  const finished = live && practice.state.finished;

  // A chord attempt that runs out of time is dropped without a word from
  // the engine: either the window expires and the keys held so far are
  // forgotten, or a late note starts the attempt over. Both look like
  // nothing happened, so they are caught here and said out loud.
  const [rolled, setRolled] = useState(false);
  const lastRef = useRef({ index, struck: struck.size });
  useEffect(() => {
    const last = lastRef.current;
    lastRef.current = { index, struck: struck.size };
    if (index !== last.index) {
      setRolled(false);
      return;
    }
    if ((last.struck > 0 && struck.size === 0) || recent[0]?.verdict === 'restarted') setRolled(true);
  }, [index, struck, recent]);

  // A wrong key is counted against the note it was meant for. The engine
  // resets its count when the note advances, so record it while it is live.
  useEffect(() => {
    if (live && wrongHere > 0 && !missed.has(index)) setMissed(new Set(missed).add(index));
  }, [live, wrongHere, index, missed]);

  useEffect(() => {
    if (live && recent.length > 0 && startedAt === null) setStartedAt(recent[recent.length - 1]!.at);
  }, [live, recent, startedAt]);

  useEffect(() => {
    if (finished && finishedAt === null) setFinishedAt(performance.now());
  }, [finished, finishedAt]);

  const next = useCallback(() => {
    setExercise((current) => generateExercise({ level: current.level, seed: newSeed() }));
  }, []);

  const setLevel = useCallback((id: number) => {
    setLevelState(id);
    try {
      globalThis.localStorage?.setItem(LEVEL_KEY, String(id));
    } catch {
      // Remembering the level is a convenience only.
    }
    setExercise(generateExercise({ level: id, seed: newSeed() }));
  }, []);

  const restart = useCallback(() => {
    practiceRestart();
    setRolled(false);
    setMissed(new Set());
    setStartedAt(null);
    setFinishedAt(null);
  }, [practiceRestart]);

  // Once an exercise is done, any key starts the next one, so your hands
  // never have to leave the piano.
  const finishedAtRef = useRef<number | null>(null);
  finishedAtRef.current = finishedAt;
  const handleMidi = useCallback(
    (event: MidiEvent, origin: EventOrigin, portId: string | null) => {
      const doneAt = finishedAtRef.current;
      if (doneAt !== null) {
        if (event.type === 'noteon' && performance.now() - doneAt > CONTINUE_AFTER_MS) next();
        return;
      }
      practiceMidi(event, origin, portId);
    },
    [practiceMidi, next],
  );

  const result = useMemo<TrainingResult | null>(() => {
    if (!finished) return null;
    return {
      notes: exercise.events,
      firstTry: cleanEvents,
      mistakes: totalMistakes,
      durationMs: startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null,
    };
  }, [finished, exercise, cleanEvents, totalMistakes, startedAt, finishedAt]);

  return {
    level,
    exercise,
    practice,
    missed,
    result,
    rolled: rolled && together && !finished,
    setLevel,
    next,
    restart,
    handleMidi,
  };
}
