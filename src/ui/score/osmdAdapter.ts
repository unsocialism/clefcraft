import type { CursorStep } from '../../core/score/fromSteps.ts';

/**
 * Reads a Score out of an OpenSheetMusicDisplay instance.
 *
 * This is the one module that knows OSMD's object graph, and OSMD's internal
 * property names have moved between versions (halfTone vs Pitch.halfTone,
 * NoteTie vs tie, and so on). Rather than pin one spelling and break on
 * upgrade, every lookup tries the known spellings in turn and the failures
 * are collected into {@link AdapterDiagnostics} so a mismatch is visible in
 * the UI instead of silently producing an empty score.
 *
 * Everything downstream of this file is pure and unit-tested; this is the
 * only place where a version mismatch can bite.
 */

export interface AdapterDiagnostics {
  /** Cursor positions visited. */
  steps: number;
  /** Note objects seen, including rests. */
  notesSeen: number;
  /** Notes whose pitch could not be read — the number to watch. */
  pitchUnreadable: number;
  rests: number;
  /** Property paths that worked, for reporting a version mismatch. */
  resolved: Record<string, string>;
  warnings: string[];
}

type Unknown = Record<string, unknown>;

function asRecord(value: unknown): Unknown | null {
  return typeof value === 'object' && value !== null ? (value as Unknown) : null;
}

/** Follow a dotted path, tolerating missing links. */
function at(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const key of path.split('.')) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

/** First path that yields a value of the expected kind. */
function firstOf(
  root: unknown,
  paths: readonly string[],
  accept: (value: unknown) => boolean,
  diagnostics: AdapterDiagnostics,
  label: string,
): unknown {
  for (const path of paths) {
    const value = at(root, path);
    if (accept(value)) {
      diagnostics.resolved[label] ??= path;
      return value;
    }
  }
  return undefined;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * OSMD stores pitch as a half-tone index where middle C is 48; MIDI puts it
 * at 60, hence the offset of 12.
 */
const HALFTONE_TO_MIDI = 12;

function readMidi(note: unknown, diagnostics: AdapterDiagnostics): number | null {
  const halfTone = firstOf(
    note,
    ['halfTone', 'Pitch.halfTone', 'pitch.halfTone', 'Pitch.HalfTone'],
    isNumber,
    diagnostics,
    'halfTone',
  );
  if (!isNumber(halfTone)) return null;
  const midi = halfTone + HALFTONE_TO_MIDI;
  return midi >= 0 && midi <= 127 ? midi : null;
}

function readIsRest(note: unknown): boolean {
  const record = asRecord(note);
  if (!record) return true;
  const method = record['isRest'];
  if (typeof method === 'function') {
    try {
      return Boolean((method as () => unknown).call(note));
    } catch {
      /* fall through to the pitch check */
    }
  }
  return at(note, 'Pitch') == null && at(note, 'pitch') == null;
}

/**
 * True when this note is the continuation of a tie rather than a fresh
 * attack. Being wrong in the safe direction matters: treating a continuation
 * as a new note means the app asks you to re-press a key you are already
 * holding, and practice mode would stall. So anything ambiguous is treated
 * as a continuation only when we can positively identify the tie's start.
 */
function readTiedFromPrevious(note: unknown, diagnostics: AdapterDiagnostics): boolean {
  const tie = at(note, 'NoteTie') ?? at(note, 'noteTie') ?? at(note, 'tie');
  if (tie == null) return false;

  const startNote = at(tie, 'StartNote') ?? at(tie, 'startNote');
  if (startNote != null) {
    diagnostics.resolved['tie'] ??= 'NoteTie.StartNote';
    return startNote !== note;
  }

  const notes = at(tie, 'Notes') ?? at(tie, 'notes');
  if (Array.isArray(notes) && notes.length > 0) {
    diagnostics.resolved['tie'] ??= 'NoteTie.Notes[0]';
    return notes[0] !== note;
  }

  diagnostics.warnings.push('A tie was found but its start note could not be identified.');
  return false;
}

function readStaff(note: unknown, diagnostics: AdapterDiagnostics): number {
  const id = firstOf(
    note,
    [
      'ParentStaffEntry.ParentStaff.Id',
      'ParentStaffEntry.ParentStaff.idInMusicSheet',
      'ParentVoiceEntry.ParentSourceStaffEntry.ParentStaff.Id',
      'sourceNote.ParentStaffEntry.ParentStaff.Id',
    ],
    isNumber,
    diagnostics,
    'staff',
  );
  if (!isNumber(id)) return 1;
  // Some paths are 0-based (idInMusicSheet), others 1-based (Id).
  return id <= 0 ? id + 1 : id;
}

function readLengthQuarters(note: unknown, diagnostics: AdapterDiagnostics): number | undefined {
  const real = firstOf(
    note,
    ['Length.RealValue', 'length.RealValue', 'Length.realValue'],
    isNumber,
    diagnostics,
    'length',
  );
  return isNumber(real) ? real * 4 : undefined;
}

export interface OsmdCursorLike {
  reset(): void;
  next(): void;
  NotesUnderCursor(): unknown[];
  readonly Iterator?: unknown;
  readonly iterator?: unknown;
}

export interface OsmdLike {
  readonly cursor: OsmdCursorLike;
  readonly Sheet?: unknown;
  readonly sheet?: unknown;
}

export interface ReadScoreResult {
  readonly steps: CursorStep[];
  readonly title: string | null;
  readonly tempoBpm: number | null;
  readonly diagnostics: AdapterDiagnostics;
}

/** Hard cap so a malformed score cannot spin forever. */
const MAX_STEPS = 100_000;

export function readCursorSteps(osmd: OsmdLike): ReadScoreResult {
  const diagnostics: AdapterDiagnostics = {
    steps: 0,
    notesSeen: 0,
    pitchUnreadable: 0,
    rests: 0,
    resolved: {},
    warnings: [],
  };

  const cursor = osmd.cursor;
  const steps: CursorStep[] = [];

  cursor.reset();

  for (let guard = 0; guard < MAX_STEPS; guard++) {
    const iterator = cursor.Iterator ?? cursor.iterator;
    const endReached = at(iterator, 'EndReached') ?? at(iterator, 'endReached');
    if (endReached === true) break;

    const onsetWholes = firstOf(
      iterator,
      ['currentTimeStamp.RealValue', 'CurrentTimeStamp.RealValue', 'currentTimeStamp.realValue'],
      isNumber,
      diagnostics,
      'timestamp',
    );
    const measureIndex = firstOf(
      iterator,
      ['CurrentMeasureIndex', 'currentMeasureIndex'],
      isNumber,
      diagnostics,
      'measureIndex',
    );
    const printedMeasure = firstOf(
      iterator,
      ['CurrentMeasure.MeasureNumber', 'currentMeasure.MeasureNumber'],
      isNumber,
      diagnostics,
      'measureNumber',
    );

    const notes: CursorStep['notes'][number][] = [];
    let underCursor: unknown[] = [];
    try {
      underCursor = cursor.NotesUnderCursor() ?? [];
    } catch (cause) {
      diagnostics.warnings.push(
        `NotesUnderCursor threw at step ${steps.length}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    for (const note of underCursor) {
      diagnostics.notesSeen++;
      if (readIsRest(note)) {
        diagnostics.rests++;
        continue;
      }
      const midi = readMidi(note, diagnostics);
      if (midi === null) {
        diagnostics.pitchUnreadable++;
        continue;
      }
      const lengthQuarters = readLengthQuarters(note, diagnostics);
      notes.push({
        midi,
        staff: readStaff(note, diagnostics),
        tiedFromPrevious: readTiedFromPrevious(note, diagnostics),
        ...(lengthQuarters === undefined ? {} : { lengthQuarters }),
      });
    }

    steps.push({
      cursorIndex: steps.length,
      onsetQuarters: isNumber(onsetWholes) ? onsetWholes * 4 : steps.length,
      measure: isNumber(printedMeasure)
        ? printedMeasure
        : isNumber(measureIndex)
          ? measureIndex + 1
          : 1,
      notes,
    });
    diagnostics.steps++;

    cursor.next();
  }

  if (diagnostics.steps >= MAX_STEPS) {
    diagnostics.warnings.push('Stopped after 100,000 cursor steps — the cursor never ended.');
  }
  if (diagnostics.steps > 0 && diagnostics.notesSeen === 0) {
    diagnostics.warnings.push(
      'The cursor moved but reported no notes — NotesUnderCursor may have changed shape.',
    );
  }
  if (diagnostics.pitchUnreadable > 0) {
    diagnostics.warnings.push(
      `${diagnostics.pitchUnreadable} note(s) had an unreadable pitch — the halfTone property may have moved.`,
    );
  }

  const sheet = osmd.Sheet ?? osmd.sheet;
  const title = firstOf(
    sheet,
    ['TitleString', 'Title.text', 'title.text'],
    (value) => typeof value === 'string' && value.length > 0,
    diagnostics,
    'title',
  );
  const tempo = firstOf(
    sheet,
    ['DefaultStartTempoInBpm', 'userStartTempoInBPM', 'defaultStartTempoInBpm'],
    (value) => isNumber(value) && value > 0,
    diagnostics,
    'tempo',
  );

  return {
    steps,
    title: typeof title === 'string' ? title : null,
    tempoBpm: isNumber(tempo) ? tempo : null,
    diagnostics,
  };
}
