import { expectedNotes, type Score, type ScoreEvent } from './types.ts';

/**
 * The practice state machine.
 *
 * Pure and immutable, and deliberately fed by note-ON events rather than by
 * the set of currently held keys. That distinction matters: playing legato
 * means the previous chord is often still down when the next one is struck,
 * so "which keys are held" cannot tell you whether the next chord was
 * actually played.
 */

export type PracticeMode =
  /** Wait for the right notes; the player sets the pace. */
  | 'wait'
  /** A clock drives the cursor; the player keeps up or does not. */
  | 'tempo';

export interface PracticeOptions {
  readonly mode: PracticeMode;
  /**
   * How close together the notes of a chord must be struck, in milliseconds,
   * or null to accept them at any spacing.
   *
   * Without this the engine cannot tell a chord from an arpeggio: pressing
   * C, then E, then G one at a time over several seconds satisfies a C major
   * triad exactly as playing it does. A window makes the distinction, and
   * notes that arrive too late are treated as the start of a fresh attempt
   * rather than as mistakes — playing it raggedly should mean "try again",
   * not "you got it wrong".
   */
  readonly chordWindowMs: number | null;
  /**
   * In wait mode, a wrong note clears the progress made on the current event
   * so the chord has to be played cleanly. Off by default: forgiving is the
   * better default for learning, and mistakes are counted either way.
   */
  readonly requireClean: boolean;
}

export const DEFAULT_PRACTICE_OPTIONS: PracticeOptions = {
  mode: 'wait',
  requireClean: false,
  chordWindowMs: null,
};

export interface PracticeState {
  readonly index: number;
  /** Expected notes of the current event that have been struck. */
  readonly struck: ReadonlySet<number>;
  /** Wrong notes played since the current event became current. */
  readonly wrongHere: number;
  readonly totalMistakes: number;
  /** Events completed without a wrong note anywhere in them. */
  readonly cleanEvents: number;
  /**
   * Notes struck that the music asked for, counting each one once. Unlike
   * `cleanEvents` it grows in play-along too, where the clock owns the
   * cursor and nothing is ever "completed" — which is what makes it the
   * measure of whether a pass was actually played rather than sat through.
   */
  readonly correctNotes: number;
  readonly finished: boolean;
  /** When the current chord attempt began, for the timing window. */
  readonly chordStartedAt: number | null;
  /** The last few keys seen, newest first — for the on-screen MIDI monitor. */
  readonly recent: readonly PressRecord[];
}

export interface PressRecord {
  readonly midi: number;
  readonly verdict: 'correct' | 'wrong' | 'restarted' | 'repeat';
  readonly at: number;
}

/** How many presses the monitor keeps. */
const RECENT_LIMIT = 8;

function remember(
  state: PracticeState,
  midi: number,
  verdict: PressRecord['verdict'],
  at: number,
): readonly PressRecord[] {
  return [{ midi, verdict, at }, ...state.recent].slice(0, RECENT_LIMIT);
}

export interface UpcomingEvent {
  readonly event: ScoreEvent;
  /** 0 = the note to play now, 1 = the one after, and so on. */
  readonly distance: number;
  /** Expected notes still outstanding (for distance 0), or all of them. */
  readonly remaining: readonly number[];
}

/** An event with nothing to strike — every note tied over — is not playable. */
function isPlayable(event: ScoreEvent): boolean {
  return expectedNotes(event).size > 0;
}

/** First playable event at or after `from`, or -1 when the score is done. */
function nextPlayableIndex(score: Score, from: number): number {
  for (let i = Math.max(0, from); i < score.events.length; i++) {
    const event = score.events[i];
    if (event && isPlayable(event)) return i;
  }
  return -1;
}

export function startPractice(score: Score): PracticeState {
  const index = nextPlayableIndex(score, 0);
  return {
    index: index === -1 ? 0 : index,
    struck: new Set(),
    wrongHere: 0,
    totalMistakes: 0,
    cleanEvents: 0,
    correctNotes: 0,
    finished: index === -1,
    chordStartedAt: null,
    recent: [],
  };
}

export function currentEvent(score: Score, state: PracticeState): ScoreEvent | null {
  if (state.finished) return null;
  return score.events[state.index] ?? null;
}

/** Move to the next playable event, banking whether this one was clean. */
function advance(score: Score, state: PracticeState): PracticeState {
  const next = nextPlayableIndex(score, state.index + 1);
  const cleanEvents = state.wrongHere === 0 ? state.cleanEvents + 1 : state.cleanEvents;
  if (next === -1) {
    return {
      ...state,
      struck: new Set(),
      wrongHere: 0,
      cleanEvents,
      finished: true,
      chordStartedAt: null,
    };
  }
  return {
    ...state,
    index: next,
    struck: new Set(),
    wrongHere: 0,
    cleanEvents,
    chordStartedAt: null,
  };
}

/**
 * Handle a key being struck.
 *
 * In wait mode this is what moves the cursor. In tempo mode the clock moves
 * the cursor and this only scores the attempt.
 */
export function pressNote(
  score: Score,
  state: PracticeState,
  midi: number,
  options: PracticeOptions = DEFAULT_PRACTICE_OPTIONS,
  now = 0,
): PracticeState {
  const event = currentEvent(score, state);
  if (!event) return state;

  const expected = expectedNotes(event);

  if (!expected.has(midi)) {
    return {
      ...state,
      wrongHere: state.wrongHere + 1,
      totalMistakes: state.totalMistakes + 1,
      // A wrong note in strict mode means the chord starts over.
      struck: options.requireClean ? new Set() : state.struck,
      chordStartedAt: options.requireClean ? null : state.chordStartedAt,
      recent: remember(state, midi, 'wrong', now),
    };
  }

  if (state.struck.has(midi)) {
    // Already counted; a re-strike is not progress, but it is worth showing.
    return { ...state, recent: remember(state, midi, 'repeat', now) };
  }

  const startedAt = state.chordStartedAt;
  const firstOfAttempt = state.struck.size === 0 || startedAt === null;

  // `== null` on purpose: an options object missing the field entirely must
  // mean "no window", not "the window is always shut". Getting this wrong
  // silently stops every chord from ever completing.
  const window = options.chordWindowMs;
  const windowed = window != null && Number.isFinite(window);

  const inTime = firstOfAttempt || !windowed || now - startedAt! <= window!;

  // A note arriving after the window has closed is not a mistake — it is the
  // first note of a fresh attempt at the same chord.
  const struck = inTime ? new Set(state.struck) : new Set<number>();
  struck.add(midi);
  const next: PracticeState = {
    ...state,
    struck,
    correctNotes: state.correctNotes + 1,
    chordStartedAt: firstOfAttempt || !inTime ? now : startedAt,
    recent: remember(state, midi, inTime ? 'correct' : 'restarted', now),
  };

  if (struck.size < expected.size) return next;
  if (options.mode === 'tempo') {
    // The clock owns the cursor; just remember the chord was completed.
    return next;
  }
  return advance(score, next);
}

/**
 * Abandon a half-played chord whose timing window has closed.
 *
 * The window cannot be enforced by `pressNote` alone: if you press one note
 * of a triad and then stop, no further event ever arrives to notice that the
 * window expired, and the partial attempt would sit there indefinitely with
 * the key you pressed no longer shown as needed. Something outside the
 * engine has to call this when the clock runs out.
 */
export function expireAttempt(state: PracticeState): PracticeState {
  if (state.struck.size === 0 && state.chordStartedAt === null) return state;
  return { ...state, struck: new Set(), chordStartedAt: null };
}

/**
 * Milliseconds until the current attempt expires, or null when nothing is in
 * flight or no window applies.
 */
export function attemptExpiresIn(
  state: PracticeState,
  options: PracticeOptions,
  now: number,
): number | null {
  const window = options.chordWindowMs;
  if (window == null || !Number.isFinite(window)) return null;
  if (state.finished || state.struck.size === 0 || state.chordStartedAt === null) return null;
  return Math.max(0, state.chordStartedAt + window - now);
}

/**
 * Tempo mode: put the cursor on the last event that has started by `quarters`
 * quarter-notes into the piece.
 */
export function advanceToTime(
  score: Score,
  state: PracticeState,
  quarters: number,
): PracticeState {
  if (score.events.length === 0) return state;

  let target = -1;
  for (let i = 0; i < score.events.length; i++) {
    const event = score.events[i];
    if (!event) continue;
    if (event.onsetQuarters <= quarters + 1e-9) {
      if (isPlayable(event)) target = i;
    } else {
      break;
    }
  }

  const last = score.events[score.events.length - 1];
  const end = last ? last.onsetQuarters + last.durationQuarters : 0;
  const finished = quarters >= end - 1e-9;

  // The clock asks this sixty times a second and the answer is usually
  // "still on the same note", so the same state is handed straight back:
  // an identical object is what lets React skip the render.
  if (target === -1 || target === state.index) {
    return state.finished === finished ? state : { ...state, finished };
  }
  return {
    ...state,
    index: target,
    struck: new Set(),
    wrongHere: 0,
    finished,
    chordStartedAt: null,
  };
}

/** Total length of the piece in quarter notes. */
export function scoreLengthQuarters(score: Score): number {
  const last = score.events[score.events.length - 1];
  return last ? last.onsetQuarters + last.durationQuarters : 0;
}

export function seekToIndex(score: Score, index: number): PracticeState {
  const target = nextPlayableIndex(score, index);
  return {
    index: target === -1 ? 0 : target,
    struck: new Set(),
    wrongHere: 0,
    totalMistakes: 0,
    cleanEvents: 0,
    correctNotes: 0,
    finished: target === -1,
    chordStartedAt: null,
    recent: [],
  };
}

/** A stretch of the piece, as bar numbers turn into events and time. */
export interface MeasureRange {
  /** Bar numbers as printed, after clamping and putting them in order. */
  readonly fromMeasure: number;
  readonly toMeasure: number;
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly startQuarters: number;
  /** The end of the last event in the range: where a pass is over. */
  readonly endQuarters: number;
  /** Notes in the range, so a pass can be told from a pass sat through. */
  readonly noteCount: number;
}

/**
 * The events between two bar numbers, inclusive of both.
 *
 * Bars rather than events because bars are what you read off the page and
 * what the section you are working on is made of. Numbers the wrong way
 * round are taken as meant — bars 12 to 9 is the same section — and numbers
 * off the end are clamped, so a range is never empty by typing.
 *
 * Null when nothing at all falls in it: a score can have bars with no notes
 * in them, and there is nothing to loop there.
 */
export function measureRange(score: Score, from: number, to: number): MeasureRange | null {
  if (score.events.length === 0) return null;
  const last = Math.max(1, score.measureCount);
  const low = Math.min(Math.max(1, Math.min(from, to)), last);
  const high = Math.min(Math.max(1, Math.max(from, to)), last);

  let firstIndex = -1;
  let lastIndex = -1;
  for (const [index, event] of score.events.entries()) {
    if (event.measure < low || event.measure > high) continue;
    if (firstIndex === -1) firstIndex = index;
    lastIndex = index;
  }
  if (firstIndex === -1) return null;

  const first = score.events[firstIndex]!;
  const final = score.events[lastIndex]!;
  let noteCount = 0;
  for (let i = firstIndex; i <= lastIndex; i++) {
    noteCount += score.events[i]?.notes.length ?? 0;
  }
  return {
    fromMeasure: low,
    toMeasure: high,
    firstIndex,
    lastIndex,
    startQuarters: first.onsetQuarters,
    endQuarters: final.onsetQuarters + final.durationQuarters,
    noteCount,
  };
}

/** How much a clean pass of a looped section is allowed to speed things up. */
const TEMPO_STEP_BPM = 5;

/**
 * The tempo for the next pass after a clean one.
 *
 * A few beats at a time and never past the limit: the point of building a
 * passage up is that each pass is only a little harder than the last.
 */
export function stepUpTempo(bpm: number, limit: number): number {
  if (bpm >= limit) return bpm;
  return Math.min(limit, bpm + TEMPO_STEP_BPM);
}

export function seekToMeasure(score: Score, measure: number): PracticeState {
  const index = score.events.findIndex((event) => event.measure >= measure);
  return seekToIndex(score, index === -1 ? score.events.length : index);
}

/**
 * The current event plus the next few, for the keyboard strip.
 * Distance 0 reports only the notes still outstanding, so keys already struck
 * stop being advertised as "play this".
 */
export function upcoming(
  score: Score,
  state: PracticeState,
  count = 3,
): readonly UpcomingEvent[] {
  if (state.finished || count <= 0) return [];

  const result: UpcomingEvent[] = [];
  let distance = 0;
  let index = state.index;

  while (distance < count && index !== -1 && index < score.events.length) {
    const event = score.events[index];
    if (!event) break;
    const expected = expectedNotes(event);
    const remaining =
      distance === 0 ? [...expected].filter((midi) => !state.struck.has(midi)) : [...expected];
    result.push({ event, distance, remaining: remaining.sort((a, b) => a - b) });
    distance++;
    index = nextPlayableIndex(score, index + 1);
  }

  return result;
}
