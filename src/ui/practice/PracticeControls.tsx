import {
  DEFAULT_CHORD_WINDOW_MS,
  type LoopProgress,
  type LoopSettings,
  type Meter,
} from '../../hooks/usePractice.ts';
import type { ClockReading } from '../../core/score/clock.ts';
import type { PracticeMode } from '../../core/score/practiceEngine.ts';
import type { Score } from '../../core/score/types.ts';
import type { PracticeState } from '../../core/score/practiceEngine.ts';
import { BeatPulse } from './BeatPulse.tsx';

/** Remembered between sessions: how you like a section to repeat. */
const LOOP_KEYS = { countIn: 'clefcraft.loop.countIn', speedUp: 'clefcraft.loop.speedUp' } as const;

function readLoopPreference(key: keyof typeof LOOP_KEYS, fallback: boolean): boolean {
  try {
    const stored = globalThis.localStorage?.getItem(LOOP_KEYS[key]);
    return stored === null || stored === undefined ? fallback : stored === 'yes';
  } catch {
    return fallback;
  }
}

function writeLoopPreference(key: keyof typeof LOOP_KEYS, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(LOOP_KEYS[key], value ? 'yes' : 'no');
  } catch {
    // Remembering it is a convenience only.
  }
}

export interface PracticeControlsProps {
  readonly score: Score;
  readonly state: PracticeState;
  readonly mode: PracticeMode;
  readonly requireClean: boolean;
  readonly chordWindowMs: number | null;
  readonly tempoBpm: number;
  readonly running: boolean;
  readonly progress: number;
  readonly meter: Meter;
  readonly clock: { readonly current: ClockReading } | null;
  readonly loop: LoopSettings | null;
  /** Null when the bars asked for hold nothing to play. */
  readonly loopEmpty: boolean;
  readonly loopProgress: LoopProgress;
  onLoopChange(loop: LoopSettings | null): void;
  onModeChange(mode: PracticeMode): void;
  onRequireCleanChange(value: boolean): void;
  onChordWindowChange(ms: number | null): void;
  onTempoChange(bpm: number): void;
  onStart(): void;
  onPause(): void;
  onRestart(): void;
  onSeekMeasure(measure: number): void;
}

export function PracticeControls({
  score,
  state,
  mode,
  requireClean,
  chordWindowMs,
  tempoBpm,
  running,
  progress,
  meter,
  clock,
  loop,
  loopEmpty,
  loopProgress,
  onLoopChange,
  onModeChange,
  onRequireCleanChange,
  onChordWindowChange,
  onTempoChange,
  onStart,
  onPause,
  onRestart,
  onSeekMeasure,
}: PracticeControlsProps) {
  const loaded = score.events.length > 0;
  const currentMeasure = score.events[state.index]?.measure ?? 1;
  const lastMeasure = Math.max(1, score.measureCount);

  /** Four bars from where you are: a phrase, and easy to widen from. */
  const startLooping = () =>
    onLoopChange({
      fromMeasure: currentMeasure,
      toMeasure: Math.min(lastMeasure, currentMeasure + 3),
      countIn: readLoopPreference('countIn', true),
      speedUp: readLoopPreference('speedUp', false),
    });

  const changeLoop = (change: Partial<LoopSettings>) => {
    if (!loop) return;
    if (change.countIn !== undefined) writeLoopPreference('countIn', change.countIn);
    if (change.speedUp !== undefined) writeLoopPreference('speedUp', change.speedUp);
    onLoopChange({ ...loop, ...change });
  };

  return (
    <div className="practice-controls">
      <div className="practice-controls__row">
        <div className="segmented" role="group" aria-label="Practice mode">
          <button
            type="button"
            className={mode === 'wait' ? 'segmented__option segmented__option--on' : 'segmented__option'}
            onClick={() => onModeChange('wait')}
          >
            Wait for me
          </button>
          <button
            type="button"
            className={mode === 'tempo' ? 'segmented__option segmented__option--on' : 'segmented__option'}
            onClick={() => onModeChange('tempo')}
          >
            Play along
          </button>
        </div>

        {mode === 'tempo' && (
          <>
            <button
              type="button"
              className="button button--primary"
              onClick={running ? onPause : onStart}
              disabled={!loaded}
            >
              {running ? 'Pause' : 'Play'}
            </button>
            <BeatPulse clock={clock} playing={running} meter={meter} />
            <label className="toolbar__field">
              <span>Tempo · {tempoBpm} bpm</span>
              <input
                type="range"
                min={30}
                max={200}
                value={tempoBpm}
                onChange={(event) => onTempoChange(Number(event.target.value))}
              />
            </label>
          </>
        )}

        {mode === 'wait' && (
          <label className="toolbar__checkbox">
            <input
              type="checkbox"
              checked={requireClean}
              onChange={(event) => onRequireCleanChange(event.target.checked)}
            />
            <span>Restart the chord on a wrong note</span>
          </label>
        )}

        <label className="toolbar__checkbox">
          <input
            type="checkbox"
            checked={chordWindowMs !== null}
            onChange={(event) =>
              onChordWindowChange(event.target.checked ? DEFAULT_CHORD_WINDOW_MS : null)
            }
          />
          <span>Chords together</span>
        </label>

        {chordWindowMs !== null && (
          <label className="toolbar__field">
            <span>Within · {chordWindowMs} ms</span>
            <input
              type="range"
              min={40}
              max={600}
              step={10}
              value={chordWindowMs}
              onChange={(event) => onChordWindowChange(Number(event.target.value))}
            />
          </label>
        )}

        <button type="button" className="button" onClick={onRestart} disabled={!loaded}>
          Restart
        </button>

        {loaded && (
          <label className="toolbar__field">
            <span>Measure</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, score.measureCount)}
              value={currentMeasure}
              onChange={(event) => onSeekMeasure(Number(event.target.value))}
            />
          </label>
        )}
      </div>

      {loaded && (
        <div className="practice-controls__row practice-controls__row--loop">
          <label className="toolbar__checkbox">
            <input
              type="checkbox"
              checked={loop !== null}
              onChange={(event) => (event.target.checked ? startLooping() : onLoopChange(null))}
            />
            <span>Repeat a section</span>
          </label>

          {loop && (
            <>
              <label className="toolbar__field toolbar__field--inline">
                <span>Bars</span>
                <input
                  type="number"
                  min={1}
                  max={lastMeasure}
                  value={loop.fromMeasure}
                  aria-label="First bar of the section"
                  onChange={(event) => changeLoop({ fromMeasure: Number(event.target.value) })}
                />
              </label>
              <label className="toolbar__field toolbar__field--inline">
                <span>to</span>
                <input
                  type="number"
                  min={1}
                  max={lastMeasure}
                  value={loop.toMeasure}
                  aria-label="Last bar of the section"
                  onChange={(event) => changeLoop({ toMeasure: Number(event.target.value) })}
                />
              </label>

              {mode === 'tempo' && (
                <>
                  <label className="toolbar__checkbox">
                    <input
                      type="checkbox"
                      checked={loop.countIn}
                      onChange={(event) => changeLoop({ countIn: event.target.checked })}
                    />
                    <span>Count me in each time</span>
                  </label>
                  <label
                    className="toolbar__checkbox"
                    title="Five beats a minute faster after every pass with no wrong notes, up to 200"
                  >
                    <input
                      type="checkbox"
                      checked={loop.speedUp}
                      onChange={(event) => changeLoop({ speedUp: event.target.checked })}
                    />
                    <span>Speed up when clean</span>
                  </label>
                </>
              )}

              {loopEmpty ? (
                <span className="toolbar__inline-note">
                  There is nothing to play in those bars.
                </span>
              ) : (
                <span className="stat">
                  {loopProgress.passes} time{loopProgress.passes === 1 ? '' : 's'} round
                  {loopProgress.passes > 0 && <> · {loopProgress.clean} clean</>}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {loaded && (
        <div className="practice-controls__row practice-controls__row--stats">
          <div className="progress" aria-label="Progress through the piece">
            <div className="progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="stat">
            Measure {currentMeasure} of {score.measureCount}
          </span>
          <span className="stat">
            {state.cleanEvents} clean
            {state.totalMistakes > 0 && <> · {state.totalMistakes} wrong</>}
          </span>
          {state.finished && <span className="badge badge--done">Finished</span>}
        </div>
      )}
    </div>
  );
}
