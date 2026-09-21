import type {
  MidiEvent,
  MidiInputSource,
  MidiPortInfo,
  MidiWiring,
  RawMidiMessage,
  Unsubscribe,
} from './types.ts';

/**
 * An in-memory {@link MidiInputSource} for tests and for the on-screen
 * keyboard's click-to-play, so the app is usable and testable with no
 * hardware attached.
 */
export class MockMidiInputSource implements MidiInputSource {
  #started = false;
  #selectedPortId: string | null = null;
  #eventListeners = new Set<(event: MidiEvent, portId: string | null) => void>();
  #portsListeners = new Set<() => void>();
  #ports: MidiPortInfo[];

  constructor(ports: MidiPortInfo[] = [{ id: 'mock-1', name: 'Virtual keyboard', manufacturer: 'clefcraft', state: 'connected' }]) {
    this.#ports = ports;
  }

  async start(): Promise<void> {
    this.#started = true;
  }

  stop(): void {
    this.#started = false;
    this.#eventListeners.clear();
    this.#portsListeners.clear();
  }

  isStarted(): boolean {
    return this.#started;
  }

  listPorts(): readonly MidiPortInfo[] {
    return this.#ports;
  }

  selectPort(id: string | null): void {
    this.#selectedPortId = id;
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

  #rawListeners = new Set<(message: RawMidiMessage) => void>();

  onRawMessage(listener: (message: RawMidiMessage) => void): Unsubscribe {
    this.#rawListeners.add(listener);
    return () => this.#rawListeners.delete(listener);
  }

  describeWiring(): MidiWiring {
    return {
      accessGrants: this.#started ? 1 : 0,
      ports: this.#ports.length,
      attached: this.#started ? this.#ports.length : 0,
      eventListeners: this.#eventListeners.size,
      rawListeners: this.#rawListeners.size,
    };
  }

  /** Test hook: push raw bytes as if they came off the wire. */
  emitRaw(bytes: readonly number[], portId: string | null = null): void {
    const at = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const listener of this.#rawListeners) listener({ bytes, portId, at });
  }

  /** Test/UI hook: push an already-decoded event to every listener. */
  emit(event: MidiEvent, portId: string | null = this.#selectedPortId ?? this.#ports[0]?.id ?? null): void {
    for (const listener of this.#eventListeners) listener(event, portId);
  }

  noteOn(note: number, velocity = 80, channel = 0): void {
    this.emit({ type: 'noteon', note, velocity, channel, time: 0 });
  }

  noteOff(note: number, channel = 0): void {
    this.emit({ type: 'noteoff', note, velocity: 0, channel, time: 0 });
  }

  sustain(down: boolean, channel = 0): void {
    this.emit({ type: 'sustain', down, channel, time: 0 });
  }

  setPorts(ports: MidiPortInfo[]): void {
    this.#ports = ports;
    for (const listener of this.#portsListeners) listener();
  }
}
