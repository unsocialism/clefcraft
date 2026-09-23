import type { Recorder } from '../../hooks/useRecorder.ts';

export interface RecordControlsProps {
  readonly recorder: Recorder;
  /** Keep the take in the score library. Absent when there is no library. */
  onSave?(): void;
  readonly saving?: boolean;
  /** The name it was saved under, once it has been. */
  readonly savedAs?: string | null;
  onDownload?(): void;
}

/**
 * Tempos a take can be written at: the one the playing was found to be in,
 * and a few round numbers to try instead when it reads oddly.
 */
function tempos(fitted: number): { bpm: number; label: string }[] {
  const offered = [...new Set([fitted, 60, 72, 90, 120])].sort((a, b) => a - b);
  return offered.map((bpm) => ({
    bpm,
    label: bpm === fitted ? `${bpm} — as played` : String(bpm),
  }));
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Recording free play.
 *
 * It sits with the other controls rather than under the music, because it
 * is something you reach for before you play, not after.
 */
export function RecordControls({
  recorder,
  onSave,
  saving = false,
  savedAs = null,
  onDownload,
}: RecordControlsProps) {
  const { phase, take, problem } = recorder;

  if (phase === 'recording') {
    return (
      <div className="record record--on">
        <button type="button" className="button button--primary" onClick={recorder.stop}>
          Stop
        </button>
        <span className="record__live">
          <span className="record__dot" aria-hidden="true" />
          {clock(recorder.elapsedMs)} · {recorder.noteCount} note
          {recorder.noteCount === 1 ? '' : 's'}
        </span>
        <span className="toolbar__inline-note">Recording. The sustain pedal is not kept.</span>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="record">
        <button type="button" className="button" onClick={recorder.start}>
          Record again
        </button>
        {take ? (
          <>
            <span className="record__live">
              {clock(take.lengthMs)} · {take.noteCount} note{take.noteCount === 1 ? '' : 's'}
            </span>
            <label className="toolbar__field">
              <span>Written at</span>
              <select
                value={recorder.tempoBpm}
                onChange={(event) => recorder.setTempoBpm(Number(event.target.value))}
              >
                {tempos(recorder.fittedBpm).map((tempo) => (
                  <option key={tempo.bpm} value={tempo.bpm}>
                    {tempo.label}
                  </option>
                ))}
              </select>
            </label>
            {onSave && (
              <button type="button" className="button button--primary" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save to Your scores'}
              </button>
            )}
            {onDownload && (
              <button
                type="button"
                className="button"
                onClick={onDownload}
                title="A standard MIDI file, which MuseScore and any DAW will open"
              >
                Download .mid
              </button>
            )}
            <button type="button" className="button" onClick={recorder.discard}>
              Discard
            </button>
            {savedAs && <span className="badge badge--done">Saved as {savedAs}</span>}
          </>
        ) : (
          <span className="toolbar__inline-note">
            {problem ?? 'Nothing was played, so there is nothing to keep.'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="record">
      <button type="button" className="button" onClick={recorder.start}>
        <span className="record__dot record__dot--still" aria-hidden="true" /> Record
      </button>
      <span className="toolbar__inline-note">
        Keeps what you play and writes it out as sheet music — to save, to download, or to
        practise against later.
      </span>
    </div>
  );
}
