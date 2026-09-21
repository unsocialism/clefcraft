/**
 * Platform-agnostic MIDI input contract.
 *
 * Nothing in `src/core` may import React, the DOM, or a Vite-specific API.
 * That is what keeps a Tauri desktop build or a Capacitor Android build from
 * needing a rewrite: they swap in a different `MidiInputSource` and reuse
 * everything else.
 */

/** A note-on/note-off/controller event, already decoded from raw bytes. */
export type MidiEvent =
  | { readonly type: 'noteon'; readonly note: number; readonly velocity: number; readonly channel: number; readonly time: number }
  | { readonly type: 'noteoff'; readonly note: number; readonly velocity: number; readonly channel: number; readonly time: number }
  | { readonly type: 'sustain'; readonly down: boolean; readonly channel: number; readonly time: number }
  | { readonly type: 'allnotesoff'; readonly channel: number; readonly time: number };

export interface MidiPortInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly state: 'connected' | 'disconnected';
}

export type Unsubscribe = () => void;

export interface MidiInputSource {
  /**
   * Request platform permission and begin listening. Rejects with a
   * {@link MidiUnavailableError} when the runtime has no MIDI support, or with
   * a {@link MidiPermissionError} when the user denied access.
   */
  start(): Promise<void>;
  stop(): void;
  listPorts(): readonly MidiPortInfo[];
  /** `null` listens to every connected port at once. */
  selectPort(id: string | null): void;
  getSelectedPortId(): string | null;
  /**
   * `portId` is the input the message arrived on. It matters because many
   * instruments expose more than one port carrying the same keyboard, and
   * listening to all of them delivers every key press twice.
   */
  onEvent(listener: (event: MidiEvent, portId: string | null) => void): Unsubscribe;
  onPortsChanged(listener: () => void): Unsubscribe;
  /**
   * Every message as it arrived, before parsing — including ones the parser
   * rejects. Diagnosing an instrument means seeing what it actually sent,
   * not what survived interpretation.
   */
  onRawMessage(listener: (message: RawMidiMessage) => void): Unsubscribe;
  /**
   * How the source is currently wired up. Purely diagnostic, and the only
   * way to tell "the app is subscribed twice" from "the instrument sends
   * twice" — from the outside the two are identical.
   */
  describeWiring(): MidiWiring;
}

export interface MidiWiring {
  /** How many times access to the MIDI system has been granted. */
  readonly accessGrants: number;
  /** Ports the browser reports. */
  readonly ports: number;
  /** Ports this source currently has a message handler on. */
  readonly attached: number;
  readonly eventListeners: number;
  readonly rawListeners: number;
}

export interface RawMidiMessage {
  readonly bytes: readonly number[];
  readonly portId: string | null;
  readonly at: number;
}

export class MidiUnavailableError extends Error {
  constructor(message = 'This browser does not support the Web MIDI API.') {
    super(message);
    this.name = 'MidiUnavailableError';
  }
}

export class MidiPermissionError extends Error {
  constructor(message = 'Access to MIDI devices was denied.') {
    super(message);
    this.name = 'MidiPermissionError';
  }
}
