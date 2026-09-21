import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readCursorSteps, type OsmdLike } from './osmdAdapter.ts';
import { buildScoreFromSteps } from '../../core/score/fromSteps.ts';

/**
 * A stand-in for OpenSheetMusicDisplay built to the property names the
 * adapter targets. This cannot prove OSMD really uses these names — only the
 * real library can — but it does prove the traversal, the tie logic, the rest
 * filtering and the half-tone conversion behave as intended, and it fails
 * loudly if the fallback chain is broken.
 */

interface FakeNote {
  halfTone?: number;
  Pitch?: { halfTone: number } | null;
  NoteTie?: { StartNote: unknown } | null;
  Length?: { RealValue: number };
  ParentStaffEntry?: { ParentStaff: { Id: number } };
  isRest?: () => boolean;
}

function makeOsmd(
  positions: { timeWholes: number; measure: number; notes: FakeNote[] }[],
  sheet: Record<string, unknown> = {},
): OsmdLike {
  let at = 0;
  const iterator = {
    get EndReached() {
      return at >= positions.length;
    },
    get currentTimeStamp() {
      return { RealValue: positions[at]?.timeWholes ?? 0 };
    },
    get CurrentMeasure() {
      return { MeasureNumber: positions[at]?.measure ?? 1 };
    },
    get CurrentMeasureIndex() {
      return (positions[at]?.measure ?? 1) - 1;
    },
  };
  return {
    Sheet: sheet,
    cursor: {
      Iterator: iterator,
      reset: () => {
        at = 0;
      },
      next: () => {
        at++;
      },
      NotesUnderCursor: () => (positions[at]?.notes ?? []) as unknown[],
    },
  };
}

const pitched = (halfTone: number, extra: Partial<FakeNote> = {}): FakeNote => ({
  halfTone,
  Pitch: { halfTone },
  Length: { RealValue: 0.25 },
  ParentStaffEntry: { ParentStaff: { Id: 1 } },
  isRest: () => false,
  ...extra,
});

const rest = (): FakeNote => ({ Pitch: null, isRest: () => true, Length: { RealValue: 0.25 } });

describe('readCursorSteps', () => {
  it('converts OSMD half-tones to MIDI (middle C is 48 there, 60 here)', () => {
    const osmd = makeOsmd([{ timeWholes: 0, measure: 1, notes: [pitched(48)] }]);
    const { steps } = readCursorSteps(osmd);
    assert.equal(steps[0]?.notes[0]?.midi, 60);
  });

  it('walks the whole cursor and records onsets in quarter notes', () => {
    const osmd = makeOsmd([
      { timeWholes: 0, measure: 1, notes: [pitched(48)] },
      { timeWholes: 0.25, measure: 1, notes: [pitched(50)] },
      { timeWholes: 0.5, measure: 1, notes: [pitched(52)] },
    ]);
    const { steps, diagnostics } = readCursorSteps(osmd);
    assert.equal(diagnostics.steps, 3);
    assert.deepEqual(steps.map((s) => s.onsetQuarters), [0, 1, 2]);
  });

  it('resets the cursor before reading, so a second read matches the first', () => {
    const osmd = makeOsmd([
      { timeWholes: 0, measure: 1, notes: [pitched(48)] },
      { timeWholes: 0.25, measure: 1, notes: [pitched(50)] },
    ]);
    const first = readCursorSteps(osmd);
    const second = readCursorSteps(osmd);
    assert.deepEqual(second.steps, first.steps);
  });

  it('skips rests but keeps their cursor position', () => {
    const osmd = makeOsmd([
      { timeWholes: 0, measure: 1, notes: [pitched(48)] },
      { timeWholes: 0.25, measure: 1, notes: [rest()] },
    ]);
    const { steps, diagnostics } = readCursorSteps(osmd);
    assert.equal(diagnostics.rests, 1);
    assert.equal(steps.length, 2);
    assert.deepEqual(steps[1]?.notes, []);
  });

  it('marks a tie continuation but not the note that starts it', () => {
    const start = pitched(48);
    const tie = { StartNote: start };
    start.NoteTie = tie;
    const continuation = pitched(48, { NoteTie: tie });

    const osmd = makeOsmd([
      { timeWholes: 0, measure: 1, notes: [start] },
      { timeWholes: 0.25, measure: 1, notes: [continuation] },
    ]);
    const { steps } = readCursorSteps(osmd);
    assert.equal(steps[0]?.notes[0]?.tiedFromPrevious, false, 'the tie start is struck');
    assert.equal(steps[1]?.notes[0]?.tiedFromPrevious, true, 'the continuation is not');
  });

  it('falls back to Pitch.halfTone when the shorthand is absent', () => {
    const note: FakeNote = {
      Pitch: { halfTone: 48 },
      isRest: () => false,
      ParentStaffEntry: { ParentStaff: { Id: 1 } },
    };
    const { steps, diagnostics } = readCursorSteps(
      makeOsmd([{ timeWholes: 0, measure: 1, notes: [note] }]),
    );
    assert.equal(steps[0]?.notes[0]?.midi, 60);
    assert.equal(diagnostics.resolved['halfTone'], 'Pitch.halfTone');
  });

  it('reports unreadable pitches rather than dropping them silently', () => {
    const broken: FakeNote = { Pitch: { halfTone: Number.NaN }, isRest: () => false };
    const { diagnostics } = readCursorSteps(
      makeOsmd([{ timeWholes: 0, measure: 1, notes: [broken] }]),
    );
    assert.equal(diagnostics.pitchUnreadable, 1);
    assert.ok(diagnostics.warnings.some((w) => w.includes('unreadable pitch')));
  });

  it('warns when the cursor moves but no notes come back', () => {
    const { diagnostics } = readCursorSteps(
      makeOsmd([{ timeWholes: 0, measure: 1, notes: [] }]),
    );
    assert.ok(diagnostics.warnings.some((w) => w.includes('no notes')));
  });

  it('survives NotesUnderCursor throwing', () => {
    const osmd = makeOsmd([{ timeWholes: 0, measure: 1, notes: [pitched(48)] }]);
    const broken: OsmdLike = {
      ...osmd,
      cursor: {
        ...osmd.cursor,
        NotesUnderCursor: () => {
          throw new Error('boom');
        },
      },
    };
    const { diagnostics } = readCursorSteps(broken);
    assert.ok(diagnostics.warnings.some((w) => w.includes('boom')));
  });

  it('reads the staff number for a left-hand note', () => {
    const left = pitched(24, { ParentStaffEntry: { ParentStaff: { Id: 2 } } });
    const { steps } = readCursorSteps(makeOsmd([{ timeWholes: 0, measure: 1, notes: [left] }]));
    assert.equal(steps[0]?.notes[0]?.staff, 2);
  });

  it('reads the title and tempo from the sheet', () => {
    const osmd = makeOsmd([{ timeWholes: 0, measure: 1, notes: [pitched(48)] }], {
      TitleString: 'Prelude',
      DefaultStartTempoInBpm: 66,
    });
    const result = readCursorSteps(osmd);
    assert.equal(result.title, 'Prelude');
    assert.equal(result.tempoBpm, 66);
  });

  it('returns nulls rather than guessing when the sheet says nothing', () => {
    const result = readCursorSteps(makeOsmd([{ timeWholes: 0, measure: 1, notes: [pitched(48)] }]));
    assert.equal(result.title, null);
    assert.equal(result.tempoBpm, null);
  });

  it('produces a Score that the practice engine can consume end to end', () => {
    const osmd = makeOsmd(
      [
        { timeWholes: 0, measure: 1, notes: [pitched(48), pitched(52), pitched(24, { ParentStaffEntry: { ParentStaff: { Id: 2 } } })] },
        { timeWholes: 0.25, measure: 1, notes: [rest()] },
        { timeWholes: 0.5, measure: 1, notes: [pitched(55)] },
      ],
      { TitleString: 'Test', DefaultStartTempoInBpm: 90 },
    );
    const { steps, title, tempoBpm } = readCursorSteps(osmd);
    const score = buildScoreFromSteps(steps, { title: title ?? undefined, tempoBpm });

    assert.equal(score.events.length, 2, 'the rest is not an event');
    assert.deepEqual(score.events[0]?.notes.map((n) => n.midi), [36, 60, 64]);
    assert.equal(score.events[0]?.durationQuarters, 2, 'spans the rest');
    assert.deepEqual(score.events[1]?.notes.map((n) => n.midi), [67]);
    assert.equal(score.tempoBpm, 90);
  });
});
