import { LEVELS, isChordLevel, levelById } from '../../core/training/generator.ts';
import type { TrainingResult, TrainingSession } from '../../hooks/useTraining.ts';

function seconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Level picker and progress, for the controls bar. */
export function TrainingControls({ training }: { training: TrainingSession }) {
  const { level, exercise, practice } = training;
  const { index, finished } = practice.state;
  const total = exercise.events;
  const current = exercise.notes.find((n) => n.event === Math.min(index, total - 1));
  const noun = isChordLevel(levelById(exercise.level)) ? 'beat' : 'note';

  return (
    <div className="toolbar toolbar--compact training-controls">
      <label className="toolbar__field training-controls__level">
        <span>Level</span>
        <select value={level} onChange={(event) => training.setLevel(Number(event.target.value))}>
          {LEVELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id} · {l.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="button" onClick={training.next}>
        New exercise
      </button>
      <button type="button" className="button" onClick={training.restart} disabled={index === 0}>
        Start over
      </button>
      <span className="toolbar__inline-note">
        {finished
          ? 'Done.'
          : training.rolled
            ? 'Not quite together — press all the notes at the same moment.'
            : `${levelById(level).description} · Bar ${current?.measure ?? 1}, ${noun} ${index + 1} of ${total}`}
      </span>
    </div>
  );
}

/** Shown under the sheet once the last note is played. */
export function TrainingSummary({
  result,
  level,
  onNext,
  onLevel,
}: {
  result: TrainingResult;
  level: number;
  onNext(): void;
  onLevel(level: number): void;
}) {
  const clean = result.firstTry === result.notes;
  const nextLevel = LEVELS.find((l) => l.id === level + 1);
  // Suggest moving up only after a nearly clean run; a level should feel
  // easy before the next one adds something new.
  const ready = nextLevel && result.firstTry >= result.notes - 1;

  return (
    <div className={clean ? 'training-summary training-summary--clean' : 'training-summary'}>
      <p className="training-summary__score">
        <strong>
          {result.firstTry} of {result.notes}
        </strong>{' '}
        right first time
        {result.mistakes > 0 && (
          <>
            {' '}
            · {result.mistakes} wrong key{result.mistakes === 1 ? '' : 's'}
          </>
        )}
        {result.durationMs !== null && <> · {seconds(result.durationMs)}</>}
      </p>
      <div className="training-summary__actions">
        <button type="button" className="button button--primary" onClick={onNext}>
          Next exercise
        </button>
        {ready && (
          <button type="button" className="button" onClick={() => onLevel(nextLevel.id)}>
            Try level {nextLevel.id}: {nextLevel.name}
          </button>
        )}
      </div>
      <p className="training-summary__hint">Or press any key on the piano to go on.</p>
    </div>
  );
}
