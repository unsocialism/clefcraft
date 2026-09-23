import type { ClockReading } from '../../core/score/clock.ts';
import { useBeat } from '../../hooks/useBeat.ts';
import type { Meter } from '../../hooks/usePractice.ts';

export interface BeatProps {
  readonly clock: { readonly current: ClockReading } | null;
  readonly playing: boolean;
  readonly meter: Meter;
}

/**
 * A metronome you can see: one dot per beat of the bar, lit as it comes
 * round. Play-along gives no sound, so without this the tempo has to be
 * inferred from notes that have already gone past.
 */
export function BeatPulse({ clock, playing, meter }: BeatProps) {
  const beat = useBeat(clock, playing);
  if (!beat || beat.beat < 1) return null;
  const beats = Math.max(1, Math.round(meter.beats));

  return (
    <div className={beat.countingIn ? 'beat beat--count' : 'beat'} aria-hidden="true">
      <span className="beat__label">{beat.countingIn ? 'Count in' : 'Beat'}</span>
      <span className="beat__dots">
        {Array.from({ length: beats }, (_, index) => {
          const at = index + 1;
          const state =
            at === beat.beat
              ? ' beat__dot--on'
              : beat.countingIn && at < beat.beat
                ? ' beat__dot--done'
                : '';
          return <span key={at} className={`beat__dot${state}`} />;
        })}
      </span>
      <span className="beat__number">{beat.beat}</span>
    </div>
  );
}

/**
 * The count-in, big enough to see from the piano.
 *
 * Over the music rather than in the controls, because the controls can be
 * hidden — and a count-in nobody can see is just a delay.
 */
export function CountIn({ clock, playing, meter }: BeatProps) {
  const beat = useBeat(clock, playing);
  if (!beat || !beat.countingIn) return null;
  const beats = Math.max(1, Math.round(meter.beats));

  return (
    <div className="count-in" role="status">
      {/* Keyed by the beat so the animation starts afresh on each one. */}
      <span className="count-in__number" key={beat.beat}>
        {beat.beat}
      </span>
      <span className="count-in__of">of {beats}</span>
    </div>
  );
}
