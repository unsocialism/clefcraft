import { useEffect, useRef, useState } from 'react';
import {
  Accidental,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow';

import { keySignatureByFifths } from '../core/music/keySignature.ts';
import type { Moment } from '../core/midi/trail.ts';
import type { AccidentalPreference } from '../core/music/pitch.ts';
import { toGrandStaffNotes, type StaffNote } from '../core/music/staff.ts';

/* Layout constants, in pixels.
 *
 * The generous top and bottom margins are not decoration: C8 sits five ledger
 * lines above the treble stave and A0 five below the bass one, and without
 * the headroom those notes are clipped off the SVG. */
const TREBLE_Y = 96;
const BASS_Y = 212;
const CANVAS_HEIGHT = 372;
const SIDE_MARGIN = 16;
const MIN_WIDTH = 320;
/** Clef and key signature at the left of each stave. */
const LEAD_IN = 60;

const NOW = '#2f6df6';
const INK = '#16191d';
/** Older moments, fading back: the further left, the longer ago. */
const PAST = ['#3c434c', '#5d646e', '#7d848d', '#9aa1aa', '#b2b8c0', '#c6cbd2', '#d5d9df'];

export interface GrandStaffProps {
  /** MIDI numbers currently sounding. */
  readonly notes: readonly number[];
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
  readonly splitPoint?: number;
  /**
   * The last few things played, oldest first. When given, the staff shows
   * them as a running trail — what you played, not only what you are
   * holding — with the newest at the right.
   */
  readonly trail?: readonly Moment[];
  /** How many slots the trail is laid out in. */
  readonly slots?: number;
}

function buildChord(
  notes: readonly StaffNote[],
  clef: 'treble' | 'bass',
  duration: string,
  colour?: string,
): StaveNote {
  const chord = new StaveNote({ keys: notes.map((note) => note.key), duration, clef });
  notes.forEach((note, index) => {
    if (note.accidental) chord.addModifier(new Accidental(note.accidental), index);
  });
  if (colour) {
    chord.setStyle({ fillStyle: colour, strokeStyle: colour });
    chord.setLedgerLineStyle({ fillStyle: colour, strokeStyle: colour });
  }
  return chord;
}

interface DrawOptions {
  readonly notes: readonly number[];
  readonly fifths: number;
  readonly accidentals: AccidentalPreference;
  readonly splitPoint: number | undefined;
  readonly trail: readonly Moment[] | undefined;
  readonly slots: number;
}

/** Pixels one moment of the trail takes up, which is how far it slides. */
function slotWidth(width: number, slots: number): number {
  return Math.max(1, (width - SIDE_MARGIN * 2 - LEAD_IN) / slots);
}

function drawStaff(container: HTMLDivElement, width: number, options: DrawOptions): void {
  const { notes, fifths, accidentals, splitPoint, trail, slots } = options;
  container.replaceChildren();

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width, CANVAS_HEIGHT);
  const context = renderer.getContext();

  const staveWidth = width - SIDE_MARGIN * 2;
  const treble = new Stave(SIDE_MARGIN, TREBLE_Y, staveWidth);
  const bass = new Stave(SIDE_MARGIN, BASS_Y, staveWidth);

  const keyName = keySignatureByFifths(fifths).vexflow;
  treble.addClef('treble').addKeySignature(keyName);
  bass.addClef('bass').addKeySignature(keyName);

  treble.setContext(context).draw();
  bass.setContext(context).draw();

  for (const type of ['brace', 'singleLeft', 'singleRight'] as const) {
    new StaveConnector(treble, bass).setType(type).setContext(context).draw();
  }

  const split = (midis: readonly number[]) =>
    toGrandStaffNotes(
      midis,
      splitPoint === undefined ? { fifths, accidentals } : { fifths, accidentals, splitPoint },
    );

  if (!trail) {
    // One chord: what is sounding right now, and nothing else.
    const { treble: trebleNotes, bass: bassNotes } = split(notes);
    // Each stave is formatted on its own: the two hands are independent
    // voices and forcing them into one formatter would align notes that need
    // not line up, and would fail outright when one stave is empty.
    if (trebleNotes.length > 0) {
      Formatter.FormatAndDraw(context, treble, [buildChord(trebleNotes, 'treble', 'w')]);
    }
    if (bassNotes.length > 0) {
      Formatter.FormatAndDraw(context, bass, [buildChord(bassNotes, 'bass', 'w')]);
    }
    return;
  }

  if (trail.length === 0) return;

  // A fixed number of slots, filled from the right. Laying the moments out
  // in the room they happen to need would make every note on the staff jump
  // sideways each time a new one arrived; with slots they only ever march
  // one step to the left.
  const shown = trail.slice(Math.max(0, trail.length - slots));
  const padding = slots - shown.length;
  const trebleSlots: (StaveNote | GhostNote)[] = [];
  const bassSlots: (StaveNote | GhostNote)[] = [];
  for (let i = 0; i < padding; i++) {
    trebleSlots.push(new GhostNote({ duration: 'q' }));
    bassSlots.push(new GhostNote({ duration: 'q' }));
  }

  shown.forEach((moment, index) => {
    const fromEnd = shown.length - 1 - index;
    const colour = fromEnd === 0 ? NOW : (PAST[fromEnd - 1] ?? PAST[PAST.length - 1] ?? INK);
    const { treble: trebleNotes, bass: bassNotes } = split(moment.notes);
    trebleSlots.push(
      trebleNotes.length > 0
        ? buildChord(trebleNotes, 'treble', 'q', colour)
        : new GhostNote({ duration: 'q' }),
    );
    bassSlots.push(
      bassNotes.length > 0
        ? buildChord(bassNotes, 'bass', 'q', colour)
        : new GhostNote({ duration: 'q' }),
    );
  });

  const voices = [trebleSlots, bassSlots].map((slotNotes, staff) => {
    const voice = new Voice({ num_beats: slots, beat_value: 4 })
      .setMode(Voice.Mode.SOFT)
      .addTickables(slotNotes);
    voice.setStave(staff === 0 ? treble : bass);
    return voice;
  });
  new Formatter().joinVoices(voices).format(voices, staveWidth - LEAD_IN);
  voices.forEach((voice, staff) => voice.draw(context, staff === 0 ? treble : bass));
}

/**
 * The live staff.
 *
 * With a trail it keeps the last few moments you played, the newest at the
 * right in blue and the ones before it fading back — so a phrase can be read
 * after it has been played, not only while a key is down. Without one it
 * shows what is sounding and nothing more.
 */
export function GrandStaff({
  notes,
  fifths = 0,
  accidentals = 'auto',
  splitPoint,
  trail,
  slots = 8,
}: GrandStaffProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [renderError, setRenderError] = useState<string | null>(null);
  // The newest moment last time round, so the staff slides when something
  // new arrives and sits still while a chord fills in.
  const newestRef = useRef<number | null>(null);

  // Track the available width so the staff reflows on resize and on a phone.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setWidth(Math.max(MIN_WIDTH, host.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      drawStaff(host, width, { notes, fifths, accidentals, splitPoint, trail, slots });
      setRenderError(null);
    } catch (cause) {
      // A rendering failure should not take the whole app down; show what
      // went wrong so a VexFlow version mismatch is obvious.
      setRenderError(cause instanceof Error ? cause.message : String(cause));
    }

    const newest = trail?.[trail.length - 1]?.id ?? null;
    if (trail && newest !== null && newest !== newestRef.current) {
      // Slide in from one slot to the right, so the trail marches rather
      // than jumping. Removing the class and reading a layout property in
      // between is what restarts an animation that is already on the
      // element.
      host.style.setProperty('--slot', `${slotWidth(width, slots)}px`);
      host.classList.remove('staff__canvas--slide');
      void host.offsetWidth;
      host.classList.add('staff__canvas--slide');
    }
    newestRef.current = newest;
  }, [notes, fifths, accidentals, splitPoint, trail, slots, width]);

  return (
    <div className="staff">
      <div ref={hostRef} className="staff__canvas" aria-label="Grand staff" role="img" />
      {renderError && <p className="staff__error">Could not draw the staff: {renderError}</p>}
    </div>
  );
}
