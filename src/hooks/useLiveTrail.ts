import { useCallback, useMemo, useRef, useState } from 'react';

import type { MidiEvent } from '../core/midi/types.ts';
import { EMPTY_TRAIL, momentsOf, trailEvent, type LiveNote, type Moment } from '../core/midi/trail.ts';

/** How many moments the running staff holds. */
export const TRAIL_MOMENTS = 8;

export interface LiveTrail {
  /** The last few things played, oldest first. */
  readonly moments: readonly Moment[];
  /**
   * Every note still in the trail, as a ref rather than state: the piano
   * roll redraws every frame against the clock, and re-rendering the app
   * sixty times a second to hand it the same list would be waste.
   */
  readonly notes: { readonly current: readonly LiveNote[] };
  handleMidi(event: MidiEvent): void;
  clear(): void;
}

/**
 * What free play has just heard.
 *
 * Its own fold rather than a second recorder: this one keeps held notes
 * (which is what a live view is mostly made of) and forgets anything that
 * has scrolled away, so it stays the same size however long you play.
 */
export function useLiveTrail(): LiveTrail {
  const [state, setState] = useState(EMPTY_TRAIL);
  const notes = useRef<readonly LiveNote[]>(state.notes);
  notes.current = state.notes;

  const handleMidi = useCallback((event: MidiEvent) => {
    const at = performance.now();
    setState((previous) => trailEvent(previous, event, at));
  }, []);

  const clear = useCallback(() => setState(EMPTY_TRAIL), []);

  const moments = useMemo(() => momentsOf(state.notes, TRAIL_MOMENTS), [state.notes]);

  return { moments, notes, handleMidi, clear };
}
