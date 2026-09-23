import type { ScoreEntry } from '../../core/library/library.ts';

export interface ScoreLibraryProps {
  readonly entries: readonly ScoreEntry[] | null;
  /** Set when the library could not be opened at all. */
  readonly error: string | null;
  onOpen(entry: ScoreEntry): void;
  onRemove(entry: ScoreEntry): void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(time: number): string {
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString();
}

/**
 * The scores kept on this device, most recently opened first.
 *
 * Deleting asks first. It is the one action here that cannot be undone,
 * and it takes your corrections to that score with it.
 */
export function ScoreLibrary({ entries, error, onOpen, onRemove }: ScoreLibraryProps) {
  if (error) {
    return (
      <p className="app__banner app__banner--error">
        Saved scores are unavailable: {error} Files still open normally, they just won't be kept.
      </p>
    );
  }

  if (entries === null) return <p className="app__banner">Loading saved scores…</p>;

  if (entries.length === 0) {
    return (
      <div className="library library--empty">
        <h2>Your scores</h2>
        <p>
          Open a MusicXML file or a PDF above. It's kept on this device, with any notes you
          correct, so next time it's one tap away.
        </p>
      </div>
    );
  }

  return (
    <div className="library">
      <h2>Your scores</h2>
      <ul className="library__list">
        {entries.map((entry) => (
          <li key={entry.id} className="library__item">
            <button type="button" className="library__open" onClick={() => onOpen(entry)}>
              <span className={`library__kind library__kind--${entry.kind}`}>
                {entry.kind === 'pdf' ? 'PDF' : entry.kind === 'midi' ? 'MIDI' : 'XML'}
              </span>
              <span className="library__name">{entry.name}</span>
              <span className="library__meta">
                {formatSize(entry.size)} · opened {formatWhen(entry.openedAt)}
              </span>
            </button>
            <button
              type="button"
              className="library__remove"
              aria-label={`Remove ${entry.name}`}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove "${entry.name}" from this device? Any notes you corrected in it go too.`,
                  )
                ) {
                  onRemove(entry);
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
