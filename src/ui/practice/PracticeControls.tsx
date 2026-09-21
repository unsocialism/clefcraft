import { DEFAULT_CHORD_WINDOW_MS } from '../../hooks/usePractice.ts';
import type { PracticeMode } from '../../core/score/practiceEngine.ts';
import type { Score } from '../../core/score/types.ts';
import type { PracticeState } from '../../core/score/practiceEngine.ts';

export interface PracticeControlsProps {
  readonly score: Score;
  readonly state: PracticeState;
  readonly mode: PracticeMode;
  readonly requireClean: boolean;
  readonly chordWindowMs: number | null;
  readonly tempoBpm: number;
  readonly running: boolean;
  readonly progress: number;
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
