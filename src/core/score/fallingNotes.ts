/**
 * The notes on their way towards the keyboard.
 *
 * The strip above the keys used to show what you had just played, rising off
 * them. In practice that is the wrong way round: by the time a note is on the
 * strip there is nothing left to do about it. Turned over, the same strip
 * shows what is coming — each note falling towards the key it belongs to and
 * arriving there at the moment it is due — which is the one thing a picture
 * can tell you that the staff above cannot, because reading a staff is a
 * skill and watching a bar come down is not.
 *
 * This module is the arithmetic of that, kept apart from the drawing: which
 * notes exist, how long each one lasts, which are in view at a given moment,
 * and how the strip moves when there is no clock to move it. All of it is in
 * quarter notes — the score's own unit — so nothing here knows about pixels,
 * tempo or frames.
 */

import { expectedNotes, handOf, type HandChoice, type Hand, type Score } from './types.ts';

/** One note as the strip draws it: a bar from its onset to its release. */
export interface FallingNote {
  readonly midi: number;
  readonly hand: Hand;
  /** When it is struck, in quarter notes from the start of the piece. */
  readonly startQuarters: number;
  /** When it lets go. Always greater than `startQuarters`. */
  readonly endQuarters: number;
  /**
   * Whether it is yours to play. False for the other hand's notes while one
   * hand is being practised: they stay on the strip, drawn faintly, the same
   * way that hand's staff stays on the page.
   */
  readonly expected: boolean;
}

/** Every note of a score, ready to be drawn, with what is needed to find them. */
export interface FallingScore {
  /** Sorted by `startQuarters`, so a window can be found by halving. */
  readonly notes: readonly FallingNote[];
  /** The longest note in it, which is how far back a search has to look. */
  readonly longestQuarters: number;
}

export const EMPTY_FALLING: FallingScore = { notes: [], longestQuarters: 0 };

/**
 * A score turned into falling bars.
 *
 * An event says only how long it is until the next one, so a note's length
 * has to be gathered: a note tied over from the event before does not begin
 * again, it makes the bar that is already there longer. That is what makes a
 * held chord one tall bar rather than a stack of short ones, and it is the
 * difference between a strip that shows the music and one that shows the
 * score's internal bookkeeping.
 */
export function fallingScore(score: Score, hands: HandChoice = 'both'): FallingScore {
  const notes: FallingNote[] = [];
  // midi -> where in `notes` the bar still being extended sits.
  const open = new Map<number, number>();
  let longest = 0;

  for (const event of score.events) {
    const until = event.onsetQuarters + Math.max(0, event.durationQuarters);
    const sounding = new Set<number>();
    const mine = expectedNotes(event, hands);

    for (const note of event.notes) {
      sounding.add(note.midi);
      const held = open.get(note.midi);
      if (note.tiedFromPrevious && held !== undefined) {
        const bar = notes[held];
        if (bar) {
          notes[held] = { ...bar, endQuarters: Math.max(bar.endQuarters, until) };
          longest = Math.max(longest, notes[held]!.endQuarters - bar.startQuarters);
        }
        continue;
      }
      // A tie whose start was never seen (a section begun mid-phrase) is
      // taken as a fresh note: better one bar too many than a note missing.
      notes.push({
        midi: note.midi,
        hand: handOf(note),
        startQuarters: event.onsetQuarters,
        endQuarters: until,
        // `expectedNotes` already applies the hand filter and drops ties, so
        // asking it is the same question the practice engine asks.
        expected: hands === 'both' || mine.has(note.midi),
      });
      open.set(note.midi, notes.length - 1);
      longest = Math.max(longest, until - event.onsetQuarters);
    }

    // Anything not in this event has stopped, so it can no longer be tied to.
    for (const midi of [...open.keys()]) if (!sounding.has(midi)) open.delete(midi);
  }

  notes.sort((a, b) => a.startQuarters - b.startQuarters || a.midi - b.midi);
  return { notes, longestQuarters: longest };
}

/**
 * The notes on the strip at musical position `now`, looking `lead` ahead.
 *
 * A note counts as in view from the moment any part of it is: one already
 * being held is still on the strip, its bar standing on the keyboard until it
 * is released. The search starts by halving rather than from the top, because
 * this runs on every frame and a long piece has thousands of notes.
 */
export function visibleAt(
  falling: FallingScore,
  now: number,
  lead: number,
): readonly FallingNote[] {
  if (lead <= 0) return [];
  const { notes } = falling;
  const horizon = now + lead;
  const visible: FallingNote[] = [];
  for (let i = firstFrom(notes, now - falling.longestQuarters); i < notes.length; i++) {
    const note = notes[i]!;
    if (note.startQuarters >= horizon) break;
    if (note.endQuarters > now) visible.push(note);
  }
  return visible;
}

/** First index whose note starts at or after `at`. */
function firstFrom(notes: readonly FallingNote[], at: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (notes[middle]!.startQuarters < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * How long one step of the strip takes, in milliseconds.
 *
 * Short enough that the next note is under your finger before you could have
 * reached for it, long enough that the eye reads it as the column moving down
 * rather than as the picture changing.
 */
export const STEP_MS = 130;
/**
 * A gap this wide is jumped rather than stepped.
 *
 * Sliding two bars of music past the keyboard in a tenth of a second is a
 * smear, and it is never what happened: a jump that big is a seek, or a
 * repeated section coming round again.
 */
export const STEP_SNAP_QUARTERS = 6;

/**
 * Where the strip has got to, `sinceMs` into a step from `from` to `to`.
 *
 * Wait mode has no clock: the music stands still until you play, and then the
 * cursor is simply at the next note. Moved straight there the column would
 * flick, which reads as a different picture rather than as the same one
 * having advanced — so it covers the gap over a few frames instead.
 *
 * The ease is given a length rather than a speed, and finishes at the end of
 * it. A curve that only approaches its target spends a tenth of a second
 * creeping the last pixel, and during that tenth of a second the note that is
 * due is drawn not quite touching the keyboard — which is the one thing this
 * strip must never say.
 *
 * Backwards is never stepped: the strip has no business running upwards.
 */
export function stepEase(from: number, to: number, sinceMs: number): number {
  const gap = to - from;
  if (gap <= 0 || gap > STEP_SNAP_QUARTERS || sinceMs >= STEP_MS) return to;
  const through = Math.max(0, sinceMs) / STEP_MS;
  // Ease out: quickest at the start, so the move registers, then settles.
  return from + gap * (1 - (1 - through) ** 3);
}
