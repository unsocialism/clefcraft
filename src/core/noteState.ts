import type { MidiEvent } from './midi/types.ts';

/**
 * What is currently sounding on the instrument.
 *
 * `down`      – keys physically held right now.
 * `sustained` – keys released while the sustain pedal was down; still ringing.
 * `pedal`     – sustain pedal state.
 *
 * Kept as a pure, immutable reducer so it can be unit-tested with no browser
 * and reused unchanged by a native shell later.
 */
export interface NoteState {
  readonly down: ReadonlySet<number>;
  readonly sustained: ReadonlySet<number>;
  readonly pedal: boolean;
  /** Velocity of the most recent note-on per note, for display. */
  readonly velocities: ReadonlyMap<number, number>;
}

export const EMPTY_NOTE_STATE: NoteState = {
  down: new Set(),
  sustained: new Set(),
  pedal: false,
  velocities: new Map(),
};

/** Every note that should be drawn: held keys plus pedal-sustained ones. */
export function soundingNotes(state: NoteState): number[] {
  const all = new Set<number>(state.down);
  for (const n of state.sustained) all.add(n);
  return [...all].sort((a, b) => a - b);
}

export function applyEvent(state: NoteState, event: MidiEvent): NoteState {
  switch (event.type) {
    case 'noteon': {
      if (state.down.has(event.note)) {
        // Re-strike of a held key: only the velocity changes.
        const velocities = new Map(state.velocities);
        velocities.set(event.note, event.velocity);
        return { ...state, velocities };
      }
      const down = new Set(state.down);
      down.add(event.note);
      // Re-striking a pedal-sustained note takes it out of the sustained set;
      // it is a held key again and its release is what re-sustains it.
      const sustained = new Set(state.sustained);
      sustained.delete(event.note);
      const velocities = new Map(state.velocities);
      velocities.set(event.note, event.velocity);
      return { down, sustained, pedal: state.pedal, velocities };
    }

    case 'noteoff': {
      if (!state.down.has(event.note)) return state;
      const down = new Set(state.down);
      down.delete(event.note);
      const sustained = new Set(state.sustained);
      const velocities = new Map(state.velocities);
      if (state.pedal) {
        sustained.add(event.note);
      } else {
        velocities.delete(event.note);
      }
      return { down, sustained, pedal: state.pedal, velocities };
    }

    case 'sustain': {
      if (event.down === state.pedal) return state;
      if (event.down) {
        return { ...state, pedal: true };
      }
      // Pedal up: everything sustained stops, held keys keep sounding.
      const velocities = new Map(state.velocities);
      for (const n of state.sustained) {
        if (!state.down.has(n)) velocities.delete(n);
      }
      return { down: state.down, sustained: new Set(), pedal: false, velocities };
    }

    case 'allnotesoff':
      return { ...EMPTY_NOTE_STATE, pedal: state.pedal };

    default:
      return state;
  }
}

export function applyEvents(state: NoteState, events: readonly MidiEvent[]): NoteState {
  return events.reduce(applyEvent, state);
}
