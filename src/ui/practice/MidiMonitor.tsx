import { noteName, spellNote, type AccidentalPreference } from '../../core/music/pitch.ts';
import type { MidiPortInfo, MidiWiring, RawMidiMessage } from '../../core/midi/types.ts';
import type { PressRecord } from '../../core/score/practiceEngine.ts';

export interface MidiMonitorProps {
  readonly recent: readonly PressRecord[];
  readonly ports: readonly MidiPortInfo[];
  readonly wiring: MidiWiring;
  readonly rawMessages: readonly RawMidiMessage[];
  readonly ignoreDuplicatesMs: number | null;
  onIgnoreDuplicatesChange(ms: number | null): void;
  readonly expected: readonly number[];
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
}

const VERDICT_LABEL: Record<PressRecord['verdict'], string> = {
  correct: 'counted',
  wrong: 'not in this chord',
  repeat: 'already had it',
  restarted: 'too late — restarted the chord',
};

/** Default echo filter: wide enough for a driver echo, far below a real repeat. */
export const DEFAULT_ECHO_FILTER_MS = 30;

const MESSAGE_KIND: Record<number, string> = {
  0x80: 'note off',
  0x90: 'note on',
  0xa0: 'aftertouch',
  0xb0: 'control change',
  0xc0: 'program change',
  0xd0: 'channel pressure',
  0xe0: 'pitch bend',
};

/** Describe a raw message the way a MIDI monitor would. */
function describe(bytes: readonly number[]): string {
  const status = bytes[0] ?? 0;
  if (status >= 0xf0) return 'system';
  if (status < 0x80) return 'running status / continuation';
  const kind = MESSAGE_KIND[status & 0xf0] ?? 'unknown';
  // Channels are 0-15 on the wire but labelled 1-16 on every instrument.
  const channel = `ch ${(status & 0x0f) + 1}`;
  const velocity = bytes[2];
  if ((status & 0xf0) === 0x90 && velocity === 0) {
    return `${channel} · note on, velocity 0 (a release)`;
  }
  if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
    return `${channel} · ${kind}, velocity ${velocity ?? '?'}`;
  }
  return `${channel} · ${kind}`;
}

/** Two arrivals of the same note this close together are one key press. */
const DUPLICATE_WINDOW_MS = 40;

interface Duplication {
  readonly count: number;
  /** Distinct ports seen delivering the duplicated presses. */
  readonly ports: readonly (string | null)[];
  readonly channels: readonly number[];
  /** The notes that actually arrived twice, so the claim is checkable. */
  readonly notes: readonly number[];
  /** Gap between the two copies, in milliseconds. */
  readonly gapMs: number;
}

/**
 * Detect duplication on the raw wire, before any filtering.
 *
 * Deliberately not computed from the post-filter arrivals: with the echo
 * filter on, the duplicates never become arrivals and the warning would fall
 * silent while the fault was still there. A diagnostic that a workaround can
 * switch off is not a diagnostic.
 */
function findDuplication(raw: readonly RawMidiMessage[]): Duplication | null {
  const ports = new Set<string | null>();
  const channels = new Set<number>();
  const notes = new Set<number>();
  let count = 0;
  let gapMs = Number.POSITIVE_INFINITY;

  // Two messages are one key press seen twice when they are the same KIND of
  // message for the same note within the window. Deliberately not "identical
  // bytes on the same port": the two causes worth telling apart are a second
  // port carrying the same keyboard and a second channel from one port, and
  // in both of those the bytes or the port differ.
  for (let i = 0; i < raw.length - 1; i++) {
    const newer = raw[i];
    const older = raw[i + 1];
    if (!newer || !older) continue;
    if (newer.at - older.at >= DUPLICATE_WINDOW_MS) continue;

    const a = newer.bytes[0] ?? 0;
    const b = older.bytes[0] ?? 0;
    // Channel-voice note messages only; a repeated clock tick is not a fault.
    const kindA = a & 0xf0;
    const kindB = b & 0xf0;
    if (a < 0x80 || a >= 0xf0 || kindA !== kindB) continue;
    if (kindA !== 0x80 && kindA !== 0x90) continue;
    if (newer.bytes[1] === undefined || newer.bytes[1] !== older.bytes[1]) continue;

    count++;
    ports.add(newer.portId);
    ports.add(older.portId);
    channels.add(a & 0x0f);
    channels.add(b & 0x0f);
    notes.add(newer.bytes[1]);
    gapMs = Math.min(gapMs, newer.at - older.at);
  }

  return count > 0
    ? {
        count,
        ports: [...ports],
        channels: [...channels].sort((x, y) => x - y),
        notes: [...notes].sort((x, y) => x - y),
        gapMs: Math.round(Number.isFinite(gapMs) ? gapMs : 0),
      }
    : null;
}

export function MidiMonitor({
  recent,
  rawMessages,
  ignoreDuplicatesMs,
  onIgnoreDuplicatesChange,
  ports,
  wiring,
  expected,
  fifths = 0,
  accidentals = 'auto',
}: MidiMonitorProps) {
  const name = (midi: number) => noteName(spellNote(midi, fifths, accidentals));
  const portName = (id: string | null) =>
    id === null ? 'on-screen' : (ports.find((p) => p.id === id)?.name ?? id);
  const duplication = findDuplication(rawMessages);

  return (
    <details className="monitor">
      <summary>
        What the app is hearing
        {duplication && <span className="monitor__flag">double input detected</span>}
      </summary>

      {duplication && (
        <p className="monitor__warning">
          {duplication.count === 1 ? 'A message arrived' : `${duplication.count} messages arrived`}{' '}
          <strong>twice</strong> on the wire —{' '}
          {duplication.notes.map(name).join(', ')}, the copies {duplication.gapMs}ms apart.{' '}
          {ignoreDuplicatesMs !== null && (
            <>
              The filter below is currently hiding this from the practice engine, but it is still
              happening.{' '}
            </>
          )}
          {duplication.ports.length > 1 ? (
            <>
              They come from two different inputs —{' '}
              <strong>{duplication.ports.map(portName).join(' and ')}</strong>. Open Settings and
              pick one of them under “Input” instead of “All inputs”.
            </>
          ) : duplication.channels.length > 1 ? (
            <>
              Both copies come from the same input but on MIDI channels{' '}
              <strong>{duplication.channels.map((c) => c + 1).join(' and ')}</strong>. Your piano is
              transmitting on two channels — usually a layered or split voice. Turn the second
              voice off on the instrument.
            </>
          ) : (
            <>Both copies arrive on the same input and channel, which points at the instrument itself.</>
          )}
        </p>
      )}

      {duplication && (
        <label className="toolbar__checkbox monitor__fix">
          <input
            type="checkbox"
            checked={ignoreDuplicatesMs !== null}
            onChange={(event) =>
              onIgnoreDuplicatesChange(event.target.checked ? DEFAULT_ECHO_FILTER_MS : null)
            }
          />
          <span>
            Ignore a repeat of the same note within {DEFAULT_ECHO_FILTER_MS}ms — a workaround, not
            a cure
          </span>
        </label>
      )}
      <p className="monitor__expected">
        Waiting for:{' '}
        {expected.length > 0 ? (
          <strong>{expected.map(name).join(' + ')}</strong>
        ) : (
          <em>nothing — the piece is finished</em>
        )}
      </p>
      <p className="monitor__wiring">
        Wiring: {wiring.accessGrants} access grant{wiring.accessGrants === 1 ? '' : 's'} ·{' '}
        {wiring.attached} of {wiring.ports} port{wiring.ports === 1 ? '' : 's'} listening ·{' '}
        {wiring.eventListeners} note subscriber{wiring.eventListeners === 1 ? '' : 's'} ·{' '}
        {wiring.rawListeners} raw subscriber{wiring.rawListeners === 1 ? '' : 's'}
        {(wiring.accessGrants > 1 || wiring.attached > 1 || wiring.eventListeners > 1) && (
          <strong> — more than one of these is why messages double; that is a bug in this app.</strong>
        )}
      </p>

      {ports.length > 1 && (
        <p className="monitor__expected">
          {ports.length} MIDI inputs are connected and all of them are being listened to.
        </p>
      )}

      {rawMessages.length > 0 && (
        <>
          <p className="monitor__expected monitor__subhead">
            Raw MIDI bytes (newest first) — exactly what the instrument sent:
          </p>
          <ol className="monitor__list monitor__list--raw">
            {rawMessages.map((m, i) => {
              const previous = rawMessages[i + 1];
              const gap = previous ? Math.round(m.at - previous.at) : null;
              const sameBytes =
                previous && previous.bytes.length === m.bytes.length &&
                previous.bytes.every((b, k) => b === m.bytes[k]);
              return (
                <li
                  key={`${m.at}-${i}`}
                  className={sameBytes ? 'monitor__row monitor__row--restarted' : 'monitor__row'}
                >
                  <span className="monitor__note">
                    {m.bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}
                  </span>
                  <span className="monitor__midi">{describe(m.bytes)}</span>
                  <span className="monitor__verdict">
                    {portName(m.portId)}
                    {gap !== null && <> · {gap}ms after the one below</>}
                    {sameBytes && ignoreDuplicatesMs !== null && gap !== null &&
                      gap < ignoreDuplicatesMs && <> · dropped by the filter</>}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <p className="monitor__expected monitor__subhead">
        What the practice engine made of each:
      </p>
      {recent.length === 0 ? (
        <p className="monitor__empty">
          No keys received yet. If you are playing and nothing appears here, the notes are not
          reaching the app at all — check the input device under Settings.
        </p>
      ) : (
        <ol className="monitor__list monitor__list--verdicts">
          {recent.map((press, index) => (
            <li key={`${press.at}-${press.midi}-${index}`} className={`monitor__row monitor__row--${press.verdict}`}>
              <span className="monitor__note">{name(press.midi)}</span>
              <span className="monitor__midi">MIDI {press.midi}</span>
              <span className="monitor__verdict">{VERDICT_LABEL[press.verdict]}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
