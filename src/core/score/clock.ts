/**
 * The play-along clock, as something you can see.
 *
 * Practice in tempo mode is driven by wall time: the cursor is moved to
 * whatever the music has reached. That is enough to judge what you played,
 * but not enough to follow along with your eyes — a cursor that jumps from
 * note to note tells you where the music is, never where it is going.
 *
 * So the clock is read here as several things instead of one: the musical
 * position (for the sweeping line on the page), which beat of the bar is
 * sounding (for the pulse), and whether the count-in bar is still ticking by
 * before the music moves — and how far through that count-in it is, so the
 * line can run up to the first note and arrive on the beat rather than
 * standing there waiting for it.
 *
 * It is a pure reading of elapsed time, with no clock of its own, so it can
 * be tested without waiting for real seconds to pass.
 */

export interface ClockReading {
  /** Musical position, in quarter notes from the start of the piece. */
  readonly quarters: number;
  /** True while the count-in is ticking by and the music is standing still. */
  readonly countingIn: boolean;
  /** Which beat is sounding, from 1: of the count-in, or of the bar. */
  readonly beat: number;
  /** 0 at the start of the beat, approaching 1 at its end. */
  readonly beatPhase: number;
  /**
   * How far through the count-in: 0 as it begins, 1 at the downbeat. Stays
   * at 1 once the music is running, so anything reading it as "how much of
   * the way in are we" needs no special case.
   */
  readonly countInProgress: number;
  /** The length of the count-in in quarter notes; 0 when there is none. */
  readonly countInQuarters: number;
}

export interface ClockOptions {
  /** Quarter notes of music since Play was pressed, count-in included. */
  readonly elapsedQuarters: number;
  /** Where the cursor stood when Play was pressed. */
  readonly startQuarters: number;
  /** Length of the count-in; 0 for none. */
  readonly countInQuarters: number;
  /** One beat, in quarter notes: 1 in 4/4, 0.5 in 6/8. */
  readonly beatQuarters: number;
  readonly beatsPerBar: number;
}

/** Floating-point slack, so a beat boundary is not missed by a millionth. */
const SLACK = 1e-9;

/** One beat in quarter notes, from the lower number of the time signature. */
export function beatQuartersFor(beatType: number): number {
  return beatType > 0 ? 4 / beatType : 1;
}

/** The count-in: one bar of the meter you are about to play in. */
export function countInQuartersFor(beats: number, beatType: number): number {
  return Math.max(1, Math.round(beats)) * beatQuartersFor(beatType);
}

export function readClock({
  elapsedQuarters,
  startQuarters,
  countInQuarters,
  beatQuarters,
  beatsPerBar,
}: ClockOptions): ClockReading {
  const beats = Math.max(1, Math.round(beatsPerBar));
  const beat = beatQuarters > 0 ? beatQuarters : 1;
  const elapsed = Math.max(0, elapsedQuarters);

  if (elapsed < countInQuarters - SLACK) {
    const through = elapsed / beat;
    const counted = Math.max(1, Math.round(countInQuarters / beat));
    const index = Math.min(Math.floor(through + SLACK), counted - 1);
    return {
      // The music has not started; `quarters` is where it will set off from,
      // and countInProgress says how much of the way there we are.
      quarters: startQuarters,
      countingIn: true,
      beat: index + 1,
      beatPhase: Math.max(0, through - Math.floor(through + SLACK)),
      countInProgress: Math.min(1, Math.max(0, elapsed / countInQuarters)),
      countInQuarters,
    };
  }

  const quarters = startQuarters + (elapsed - Math.max(0, countInQuarters));
  const through = quarters / beat;
  const whole = Math.floor(through + SLACK);
  return {
    quarters,
    countingIn: false,
    // Bars are counted from the start of the piece, which is where the
    // barlines are drawn from too.
    beat: (((whole % beats) + beats) % beats) + 1,
    beatPhase: Math.max(0, through - whole),
    countInProgress: 1,
    countInQuarters: Math.max(0, countInQuarters),
  };
}

/** The clock at rest: nothing playing, nothing to draw. */
export const CLOCK_IDLE: ClockReading = {
  quarters: 0,
  countingIn: false,
  beat: 0,
  beatPhase: 0,
  countInProgress: 1,
  countInQuarters: 0,
};
