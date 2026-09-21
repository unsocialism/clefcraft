import { parseMidiMessage } from './parse.ts';
import {
  MidiPermissionError,
  MidiUnavailableError,
  type MidiEvent,
  type MidiInputSource,
  type MidiPortInfo,
  type MidiWiring,
  type RawMidiMessage,
  type Unsubscribe,
} from './types.ts';

/* ------------------------------------------------------------------ *
 * Minimal structural types for the Web MIDI API.
 *
 * Declared locally rather than pulled from @types/webmidi so that we neither
 * add a dependency nor collide with whatever lib.dom ships in a future
 * TypeScript release.
 * ------------------------------------------------------------------ */

interface MidiMessageEventLike {
  readonly data: Uint8Array | null;
  readonly timeStamp: number;
}

interface MidiInputLike {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer: string | null;
  readonly state: string;
  onmidimessage: ((event: MidiMessageEventLike) => void) | null;
}

interface MidiAccessLike {
  readonly inputs: Map<string, MidiInputLike>;
  onstatechange: ((event: unknown) => void) | null;
}

interface NavigatorWithMidi {
  requestMIDIAccess?: (options?: { sysex?: boolean; software?: boolean }) => Promise<MidiAccessLike>;
}

/** True when the current runtime exposes the Web MIDI API at all. */
export function isWebMidiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as unknown as NavigatorWithMidi).requestMIDIAccess === 'function'
  );
}

/**
 * Web MIDI implementation of {@link MidiInputSource}.
 *
 * Chrome, Edge and Opera support Web MIDI on desktop and on Android. Firefox
 * requires the site to be granted MIDI permission, and Safari (desktop and
 * iOS) does not implement it at all — hence `isWebMidiSupported()` and the
 * typed errors, so the UI can say something useful instead of hanging.
 */
export class WebMidiInputSource implements MidiInputSource {
  #access: MidiAccessLike | null = null;
  #selectedPortId: string | null = null;
  #eventListeners = new Set<(event: MidiEvent, portId: string | null) => void>();
  #portsListeners = new Set<() => void>();
  #rawListeners = new Set<(message: RawMidiMessage) => void>();
  #starting: Promise<void> | null = null;
  #accessGrants = 0;

  /**
   * Request access and begin listening. Safe to call repeatedly.
   *
   * The idempotence is not a nicety. Every `requestMIDIAccess()` call returns
   * a *fresh* MIDIAccess whose MIDIInput objects are distinct from the
   * previous ones, and the browser delivers each hardware message to every
   * one of them that still has a handler attached. Calling start() twice —
   * which React's development double-mount does by itself — therefore makes
   * every key press arrive twice, with byte-identical messages microseconds
   * apart. It looks exactly like a misbehaving instrument.
   */
  async start(): Promise<void> {
    if (this.#starting) return this.#starting;
    this.#starting = this.#doStart().catch((error: unknown) => {
      // A failed attempt must not wedge the source: let the next call retry.
      this.#starting = null;
      throw error;
    });
    return this.#starting;
  }

  async #doStart(): Promise<void> {
    const nav = navigator as unknown as NavigatorWithMidi;
    if (typeof nav.requestMIDIAccess !== 'function') {
      throw new MidiUnavailableError();
    }

    let access: MidiAccessLike;
    try {
      // sysex is not requested: a note display does not need it, and asking
      // for it triggers a stricter permission prompt.
      access = await nav.requestMIDIAccess({ sysex: false });
    } catch (cause) {
      throw new MidiPermissionError(
        cause instanceof Error ? `MIDI access was refused: ${cause.message}` : undefined,
      );
    }

    this.#accessGrants++;

    // Belt and braces: release any earlier access before taking a new one, so
    // its inputs cannot keep delivering alongside the new ones.
    this.#detachAll();

    this.#access = access;
    access.onstatechange = () => {
      this.#attachHandlers();
      for (const listener of this.#portsListeners) listener();
    };
    this.#attachHandlers();
  }

  /** Silence the current access's inputs without discarding listeners. */
  #detachAll(): void {
    if (!this.#access) return;
    for (const input of this.#access.inputs.values()) input.onmidimessage = null;
    this.#access.onstatechange = null;
    this.#access = null;
  }

  stop(): void {
    this.#detachAll();
    this.#starting = null;
    this.#eventListeners.clear();
    this.#portsListeners.clear();
    this.#rawListeners.clear();
  }

  listPorts(): readonly MidiPortInfo[] {
    if (!this.#access) return [];
    return [...this.#access.inputs.values()].map((input) => ({
      id: input.id,
      name: input.name ?? 'Unnamed MIDI input',
      manufacturer: input.manufacturer ?? '',
      state: input.state === 'connected' ? ('connected' as const) : ('disconnected' as const),
    }));
  }

  selectPort(id: string | null): void {
    this.#selectedPortId = id;
    this.#attachHandlers();
  }

  getSelectedPortId(): string | null {
    return this.#selectedPortId;
  }

  onEvent(listener: (event: MidiEvent, portId: string | null) => void): Unsubscribe {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onPortsChanged(listener: () => void): Unsubscribe {
    this.#portsListeners.add(listener);
    return () => this.#portsListeners.delete(listener);
  }

  onRawMessage(listener: (message: RawMidiMessage) => void): Unsubscribe {
    this.#rawListeners.add(listener);
    return () => this.#rawListeners.delete(listener);
  }

  /** Listen on the selected port, or on every port when none is selected. */
  #attachHandlers(): void {
    if (!this.#access) return;
    for (const input of this.#access.inputs.values()) {
      const wanted = this.#selectedPortId === null || this.#selectedPortId === input.id;
      input.onmidimessage = wanted ? (event) => this.#handleMessage(event, input.id) : null;
    }
  }

  describeWiring(): MidiWiring {
    const inputs = this.#access ? [...this.#access.inputs.values()] : [];
    return {
      accessGrants: this.#accessGrants,
      ports: inputs.length,
      attached: inputs.filter((input) => input.onmidimessage !== null).length,
      eventListeners: this.#eventListeners.size,
      rawListeners: this.#rawListeners.size,
    };
  }

  #handleMessage(event: MidiMessageEventLike, portId: string): void {
    if (!event.data) return;
    if (this.#rawListeners.size > 0) {
      const raw: RawMidiMessage = {
        bytes: [...event.data],
        portId,
        at: typeof performance !== 'undefined' ? performance.now() : 0,
      };
      for (const listener of this.#rawListeners) listener(raw);
    }
    const parsed = parseMidiMessage(event.data, event.timeStamp);
    if (!parsed) return;
    for (const listener of this.#eventListeners) listener(parsed, portId);
  }
}
