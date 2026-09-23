import { useEffect, useState } from 'react';

import type { ClockReading } from '../core/score/clock.ts';

export interface Beat {
  /** 1-based: which beat of the bar, or of the count-in, is sounding. */
  readonly beat: number;
  readonly countingIn: boolean;
}

/**
 * The beat the play-along clock is on.
 *
 * The clock itself moves every frame, which is far more often than anything
 * made of beats needs to change, so it is polled rather than subscribed to
 * and the same object is handed back until the beat actually turns over —
 * which is what keeps this from re-rendering sixty times a second.
 */
export function useBeat(
  clock: { readonly current: ClockReading } | null | undefined,
  playing: boolean,
): Beat | null {
  const [beat, setBeat] = useState<Beat | null>(null);

  useEffect(() => {
    if (!clock || !playing) {
      setBeat(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const now = clock.current;
      setBeat((previous) =>
        previous && previous.beat === now.beat && previous.countingIn === now.countingIn
          ? previous
          : { beat: now.beat, countingIn: now.countingIn },
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, playing]);

  return beat;
}
