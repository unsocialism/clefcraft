import { useEffect, useRef, useState } from 'react';
import { Accidental, Formatter, Renderer, Stave, StaveConnector, StaveNote } from 'vexflow';

import { keySignatureByFifths } from '../core/music/keySignature.ts';
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

export interface GrandStaffProps {
  /** MIDI numbers currently sounding. */
  readonly notes: readonly number[];
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
  readonly splitPoint?: number;
}

function buildChord(notes: readonly StaffNote[], clef: 'treble' | 'bass'): StaveNote {
  const chord = new StaveNote({
    keys: notes.map((note) => note.key),
    duration: 'w',
    clef,
  });
  notes.forEach((note, index) => {
    if (note.accidental) chord.addModifier(new Accidental(note.accidental), index);
  });
  return chord;
}

function drawStaff(
  container: HTMLDivElement,
  width: number,
  notes: readonly number[],
  fifths: number,
  accidentals: AccidentalPreference,
  splitPoint: number | undefined,
): void {
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

  const options = splitPoint === undefined ? { fifths, accidentals } : { fifths, accidentals, splitPoint };
  const { treble: trebleNotes, bass: bassNotes } = toGrandStaffNotes(notes, options);

  // Each stave is formatted on its own: the two hands are independent voices
  // and forcing them into one formatter would align notes that need not line
  // up, and would fail outright when one stave is empty.
  if (trebleNotes.length > 0) {
    Formatter.FormatAndDraw(context, treble, [buildChord(trebleNotes, 'treble')]);
  }
  if (bassNotes.length > 0) {
    Formatter.FormatAndDraw(context, bass, [buildChord(bassNotes, 'bass')]);
  }
}

export function GrandStaff({ notes, fifths = 0, accidentals = 'auto', splitPoint }: GrandStaffProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [renderError, setRenderError] = useState<string | null>(null);

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
      drawStaff(host, width, notes, fifths, accidentals, splitPoint);
      setRenderError(null);
    } catch (cause) {
      // A rendering failure should not take the whole app down; show what
      // went wrong so a VexFlow version mismatch is obvious.
      setRenderError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [notes, fifths, accidentals, splitPoint, width]);

  return (
    <div className="staff">
      <div ref={hostRef} className="staff__canvas" aria-label="Grand staff" role="img" />
      {renderError && <p className="staff__error">Could not draw the staff: {renderError}</p>}
    </div>
  );
}
