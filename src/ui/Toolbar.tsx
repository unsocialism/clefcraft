import { KEY_SIGNATURES } from '../core/music/keySignature.ts';
import type { AccidentalPreference } from '../core/music/pitch.ts';
import type { MidiPortInfo } from '../core/midi/types.ts';
import type { MidiStatus } from '../hooks/usePianoInput.ts';

export interface ToolbarProps {
  readonly status: MidiStatus;
  readonly errorMessage: string | null;
  readonly ports: readonly MidiPortInfo[];
  readonly selectedPortId: string | null;
  readonly fifths: number;
  readonly accidentals: AccidentalPreference;
  readonly showLabels: boolean;
  onConnect(): void;
  onSelectPort(id: string | null): void;
  onFifthsChange(fifths: number): void;
  onAccidentalsChange(preference: AccidentalPreference): void;
  onShowLabelsChange(show: boolean): void;
  onPanic(): void;
}

const STATUS_TEXT: Record<MidiStatus, string> = {
  idle: 'Not connected',
  connecting: 'Asking for MIDI access…',
  ready: 'Listening',
  unsupported: 'Web MIDI is not available in this browser',
  denied: 'MIDI access was denied',
  error: 'MIDI failed to start',
};

export function Toolbar({
  status,
  errorMessage,
  ports,
  selectedPortId,
  fifths,
  accidentals,
  showLabels,
  onConnect,
  onSelectPort,
  onFifthsChange,
  onAccidentalsChange,
  onShowLabelsChange,
  onPanic,
}: ToolbarProps) {
  const connected = status === 'ready';

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <span className={`status status--${status}`}>
          <span className="status__dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
        {!connected && status !== 'unsupported' && (
          <button type="button" className="button button--primary" onClick={onConnect} disabled={status === 'connecting'}>
            {status === 'idle' ? 'Connect piano' : 'Try again'}
          </button>
        )}
      </div>

      {connected && (
        <label className="toolbar__field">
          <span>Input</span>
          <select
            value={selectedPortId ?? ''}
            onChange={(event) => onSelectPort(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">All inputs</option>
            {ports.map((port) => (
              <option key={port.id} value={port.id}>
                {port.name}
                {port.manufacturer ? ` — ${port.manufacturer}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="toolbar__field">
        <span>Key</span>
        <select value={fifths} onChange={(event) => onFifthsChange(Number(event.target.value))}>
          {KEY_SIGNATURES.map((key) => (
            <option key={key.fifths} value={key.fifths}>
              {key.name}
            </option>
          ))}
        </select>
      </label>

      <label className="toolbar__field">
        <span>Accidentals</span>
        <select
          value={accidentals}
          onChange={(event) => onAccidentalsChange(event.target.value as AccidentalPreference)}
        >
          <option value="auto">Follow the key</option>
          <option value="sharps">Prefer sharps</option>
          <option value="flats">Prefer flats</option>
        </select>
      </label>

      <label className="toolbar__checkbox">
        <input
          type="checkbox"
          checked={showLabels}
          onChange={(event) => onShowLabelsChange(event.target.checked)}
        />
        <span>Label keys</span>
      </label>

      <button type="button" className="button" onClick={onPanic} title="Clear any notes stuck on screen">
        Reset
      </button>

      {connected && ports.length === 0 && (
        <p className="toolbar__note">
          No MIDI inputs found. Plug the piano in over USB and switch it on — the list updates on its own.
        </p>
      )}

      {errorMessage && status !== 'ready' && <p className="toolbar__error">{errorMessage}</p>}
    </div>
  );
}
