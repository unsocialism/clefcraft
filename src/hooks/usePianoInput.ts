import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MockMidiInputSource } from '../core/midi/mockSource.ts';
import {
  MidiPermissionError,
  MidiUnavailableError,
  type MidiEvent,
  type MidiInputSource,
  type MidiPortInfo,
  type MidiWiring,
  type RawMidiMessage,
} from '../core/midi/types.ts';
import { WebMidiInputSource, isWebMidiSupported } from '../core/midi/webMidiSource.ts';
import { EMPTY_NOTE_STATE, applyEvent, soundingNotes, type NoteState } from '../core/noteState.ts';

export type EventOrigin = 'device' | 'virtual';

export type MidiStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'unsupported'
  | 'denied'
  | 'error';

export interface PianoInput {
  readonly status: MidiStatus;
  readonly errorMessage: string | null;
  readonly ports: readonly MidiPortInfo[];
  readonly selectedPortId: string | null;
  readonly noteState: NoteState;
  readonly notes: readonly number[];
  connect(): void;
  selectPort(id: string | null): void;
  /** Feed an event in by hand — used by the clickable on-screen keyboard. */
  send(event: MidiEvent): void;
  panic(): void;
  /** Diagnostic snapshot of how the source is wired up right now. */
  getWiring(): MidiWiring;
}

/**
 * Owns the MIDI connection and folds incoming events into note state.
 *
 * The source is behind {@link MidiInputSource}, so swapping in a native
 * bridge (Capacitor plugin on Android, a Tauri command on desktop) is a
 * one-line change here and touches nothing else.
 */
export interface PianoInputOptions {
  /**
   * Called for every decoded MIDI event, before it is folded into note
   * state. Practice mode listens here rather than watching the held-note
   * set, because only the event stream distinguishes a fresh strike from a
   * key that was already down.
   *
   * `origin` says where the event came from. It matters for chord timing: a
   * mouse can only click one key at a time, so a timing window that is right
   * for a real instrument would make chords impossible on the on-screen
   * keyboard.
   */
  readonly onEvent?: (event: MidiEvent, origin: EventOrigin, portId: string | null) => void;
  /** Every message off the wire, including ones the parser rejects. */
  readonly onRawMessage?: (message: RawMidiMessage) => void;
  readonly makeSource?: () => MidiInputSource;
}

export function usePianoInput(options: PianoInputOptions = {}): PianoInput {
  const { onEvent, onRawMessage, makeSource } = options;
  const [status, setStatus] = useState<MidiStatus>(() =>
    makeSource || isWebMidiSupported() ? 'idle' : 'unsupported',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ports, setPorts] = useState<readonly MidiPortInfo[]>([]);
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null);
  const [noteState, setNoteState] = useState<NoteState>(EMPTY_NOTE_STATE);

  const sourceRef = useRef<MidiInputSource | null>(null);
  if (sourceRef.current === null) {
    sourceRef.current = makeSource
      ? makeSource()
      : isWebMidiSupported()
        ? new WebMidiInputSource()
        : new MockMidiInputSource([]);
  }
  const source = sourceRef.current;

  // Held in a ref so a changing listener never forces a re-subscribe, which
  // would drop events in the middle of a chord.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onRawRef = useRef(onRawMessage);
  onRawRef.current = onRawMessage;

  const handleEvent = useCallback(
    (event: MidiEvent, portId: string | null = null, origin: EventOrigin = 'device') => {
      onEventRef.current?.(event, origin, portId);
      setNoteState((previous) => applyEvent(previous, event));
    },
    [],
  );

  useEffect(() => {
    const unsubscribeEvents = source.onEvent((event, portId) => handleEvent(event, portId));
    const unsubscribeRaw = source.onRawMessage((message) => onRawRef.current?.(message));
    const unsubscribePorts = source.onPortsChanged(() => setPorts(source.listPorts()));
    return () => {
      unsubscribeEvents();
      unsubscribeRaw();
      unsubscribePorts();
    };
  }, [source, handleEvent]);

  // Tear the connection down when the component unmounts for good.
  useEffect(() => () => source.stop(), [source]);

  // A second guard in front of the source's own. `setStatus` is batched, so
  // two effect invocations in the same tick both still see 'idle' and would
  // otherwise both call start().
  const connectingRef = useRef(false);

  const connect = useCallback(() => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setStatus('connecting');
    setErrorMessage(null);
    source
      .start()
      .then(() => {
        connectingRef.current = false;
        setPorts(source.listPorts());
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        connectingRef.current = false;
        if (cause instanceof MidiUnavailableError) {
          setStatus('unsupported');
        } else if (cause instanceof MidiPermissionError) {
          setStatus('denied');
        } else {
          setStatus('error');
        }
        setErrorMessage(cause instanceof Error ? cause.message : String(cause));
      });
  }, [source]);

  const selectPort = useCallback(
    (id: string | null) => {
      source.selectPort(id);
      setSelectedPortId(id);
      // Anything held on the old port would otherwise stay stuck on screen.
      setNoteState(EMPTY_NOTE_STATE);
    },
    [source],
  );

  // `send` is the injection path used by the on-screen keyboard, so anything
  // arriving through it is by definition not from the instrument.
  const send = useCallback(
    (event: MidiEvent) => handleEvent(event, null, 'virtual'),
    [handleEvent],
  );

  const panic = useCallback(() => setNoteState(EMPTY_NOTE_STATE), []);

  const getWiring = useCallback(() => source.describeWiring(), [source]);

  const notes = useMemo(() => soundingNotes(noteState), [noteState]);

  return {
    status,
    errorMessage,
    ports,
    selectedPortId,
    noteState,
    notes,
    connect,
    selectPort,
    send,
    panic,
    getWiring,
  };
}
