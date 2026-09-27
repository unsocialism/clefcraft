import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accidental,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow';

import { keySignatureByFifths } from '../../core/music/keySignature.ts';
import type { Moment } from '../../core/midi/trail.ts';
import type { AccidentalPreference } from '../../core/music/pitch.ts';
import { toGrandStaffNotes, type StaffNote } from '../../core/music/staff.ts';
import {
  EMPTY_SHEET,
  restartWhenEmpty,
  sheetRows,
  writeMoments,
  type SheetLayout,
  type SheetState,
} from '../../core/score/liveSheet.ts';

/* Layout, in pixels, drawn at the size it is shown so nothing is scaled. */

/** Treble stave to bass stave inside one system. */
const STAVE_GAP = 74;
/**
 * One system, top to top. A stave is forty pixels of lines; the rest is the
 * room notes need above and below before they run into the line above.
 */
const SYSTEM_HEIGHT = 134;
const MARGIN_TOP = 30;
/** Room under the last system, for the stems and ledger lines below it. */
const MARGIN_BOTTOM = 22;
/**
 * How far a system may be stretched to fill the room there is. The staves
 * inside one keep their spacing — a grand staff is a fixed thing — so the
 * stretch all goes between systems, which is where notes on ledger lines
 * need it.
 */
const MOST_STRETCH = 1.7;
const SIDE_MARGIN = 12;
/** Clef, key signature and the room the brace needs. */
const LEAD_IN = 56;
const KEY_WIDTH = 9;
const MIN_WIDTH = 300;
/** Beyond four lines the notes are too old to be looking at. */
const MOST_LINES = 4;
/**
 * Under this width, half as many bars to a line. Four bars is what a page of
 * piano music has, but four bars is also sixteen places for a note, and on a
 * phone that leaves twenty pixels each — less than a chord with an
 * accidental needs. Printed music for a small page does the same thing.
 */
const NARROW = 560;

const INK = '#16191d';
/** The note just played, so the eye can find where the writing has got to. */
const NOW = '#2f6df6';
/** Nothing at all, drawn where a note would be. See `blank`. */
const INVISIBLE = 'rgba(0, 0, 0, 0)';

/**
 * A note's worth of nothing.
 *
 * A slot with no note in it still has to take up a note's room, or the bar
 * being written re-spaces itself every time a note lands in it and the notes
 * already there shuffle sideways — which is the very thing this sheet exists
 * to stop. VexFlow's own `GhostNote` takes up no room at all, so an ordinary
 * note is drawn in the middle of the staff in no colour instead.
 */
function blank(clef: 'treble' | 'bass'): StaveNote {
  const note = new StaveNote({ keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: 'q', clef });
  note.setStyle({ fillStyle: INVISIBLE, strokeStyle: INVISIBLE });
  note.setStemStyle({ fillStyle: INVISIBLE, strokeStyle: INVISIBLE });
  return note;
}

export interface LiveSheetProps {
  /** What has been played, oldest first. */
  readonly moments: readonly Moment[];
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
  readonly splitPoint?: number;
  readonly barsPerLine?: number;
  readonly beatsPerBar?: number;
}

function buildChord(
  notes: readonly StaffNote[],
  clef: 'treble' | 'bass',
  colour: string,
): StaveNote {
  const chord = new StaveNote({
    keys: notes.map((note) => note.key),
    duration: 'q',
    clef,
    // Stems up below the middle line and down above it, as an engraver
    // writes them: all-stems-up is the giveaway that something machine-made
    // is pretending to be a page of music.
    auto_stem: true,
  });
  notes.forEach((note, index) => {
    if (note.accidental) chord.addModifier(new Accidental(note.accidental), index);
  });
  chord.setStyle({ fillStyle: colour, strokeStyle: colour });
  chord.setLedgerLineStyle({ fillStyle: colour, strokeStyle: colour });
  return chord;
}

interface DrawOptions {
  readonly layout: SheetLayout;
  readonly fifths: number;
  readonly accidentals: AccidentalPreference;
  readonly splitPoint: number | undefined;
  readonly barsPerLine: number;
  readonly beatsPerBar: number;
  readonly systemHeight: number;
  readonly lines: number;
}

/** Five lines of a stave, in pixels, at VexFlow's own spacing. */
const STAVE_LINES = 40;

function draw(host: HTMLDivElement, width: number, room: number, options: DrawOptions): void {
  const { layout, fifths, accidentals, splitPoint, barsPerLine, beatsPerBar, systemHeight } =
    options;
  host.replaceChildren();

  const height = MARGIN_TOP + options.lines * systemHeight + MARGIN_BOTTOM;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();
  const key = keySignatureByFifths(fifths);
  const leadIn = LEAD_IN + Math.abs(fifths) * KEY_WIDTH + (layout.fromTheStart ? 26 : 0);

  const usable = width - SIDE_MARGIN * 2;
  const plain = (usable - leadIn) / barsPerLine;

  const split = (midis: readonly number[]) =>
    toGrandStaffNotes(
      midis,
      splitPoint === undefined ? { fifths, accidentals } : { fifths, accidentals, splitPoint },
    );

  // The pair of staves sits in the middle of its system, so the room left
  // over after stretching is shared between the notes above the treble and
  // those below the bass rather than all falling below.
  const inset = Math.max(0, (systemHeight - (STAVE_GAP + STAVE_LINES)) / 2);

  layout.rows.forEach((row, line) => {
    const top = MARGIN_TOP + line * systemHeight + inset;
    let x = SIDE_MARGIN;

    for (let bar = 0; bar < barsPerLine; bar++) {
      const opens = bar === 0;
      const barWidth = opens ? plain + leadIn : plain;
      const staves = ([0, 1] as const).map((staff) => {
        const stave = new Stave(x, top + staff * STAVE_GAP, barWidth);
        if (opens) {
          stave.addClef(staff === 0 ? 'treble' : 'bass').addKeySignature(key.vexflow);
          // A time signature belongs at the start of the music and nowhere
          // else. Once the sheet has run on past its first line, these are
          // continuation lines, and a time signature on one would say the
          // metre had just changed.
          if (layout.fromTheStart && line === 0) stave.addTimeSignature(`${beatsPerBar}/4`);
        }
        stave.setContext(context).draw();
        return stave;
      });

      const [treble, bass] = staves as [Stave, Stave];
      if (opens) {
        new StaveConnector(treble, bass).setType('brace').setContext(context).draw();
        new StaveConnector(treble, bass).setType('singleLeft').setContext(context).draw();
      }
      new StaveConnector(treble, bass).setType('singleRight').setContext(context).draw();

      const trebleNotes: StaveNote[] = [];
      const bassNotes: StaveNote[] = [];
      for (let beat = 0; beat < beatsPerBar; beat++) {
        const slot = bar * beatsPerBar + beat;
        const moment = row[slot] ?? null;
        const isNewest = layout.newest?.row === line && layout.newest?.slot === slot;
        const colour = isNewest ? NOW : INK;
        if (!moment) {
          // Nothing played here yet. A rest would be a lie — it would say
          // you meant the silence — so the bar is simply left waiting.
          trebleNotes.push(blank('treble'));
          bassNotes.push(blank('bass'));
          continue;
        }
        const parts = split(moment.notes);
        trebleNotes.push(
          parts.treble.length > 0 ? buildChord(parts.treble, 'treble', colour) : blank('treble'),
        );
        bassNotes.push(
          parts.bass.length > 0 ? buildChord(parts.bass, 'bass', colour) : blank('bass'),
        );
      }

      const voices = [trebleNotes, bassNotes].map((notes, staff) => {
        const voice = new Voice({ num_beats: beatsPerBar, beat_value: 4 })
          .setMode(Voice.Mode.SOFT)
          .addTickables(notes);
        voice.setStave(staff === 0 ? treble : bass);
        return voice;
      });
      const room = barWidth - (opens ? leadIn : 0) - 14;
      new Formatter().joinVoices(voices).format(voices, room);

      /*
       * Put every slot where an empty bar would put it.
       *
       * An engraver spaces a bar by what is in it: a note with a ledger line
       * or an accidental is wider, and its neighbours give way. That is
       * right for a finished page and wrong for one being written, because
       * the bar re-spaces itself each time a note lands in it and everything
       * already there shifts sideways — which is the very thing this sheet
       * exists to stop.
       *
       * So a bar of nothing is formatted against the same stave first, and
       * its four positions are the grid the real notes are moved on to.
       * Asking VexFlow where it would put four blanks, rather than working
       * the positions out from the stave's width, is what keeps this honest:
       * the clef, the key and the padding are all already accounted for in
       * the answer.
       */
      const ruler = new Voice({ num_beats: beatsPerBar, beat_value: 4 })
        .setMode(Voice.Mode.SOFT)
        .addTickables(Array.from({ length: beatsPerBar }, () => blank('treble')));
      ruler.setStave(treble);
      new Formatter().joinVoices([ruler]).format([ruler], room);
      const grid = ruler.getTickables().map((note) => note.getAbsoluteX());
      for (const voice of voices) {
        voice.getTickables().forEach((note, beat) => {
          const want = grid[beat];
          if (want !== undefined) note.setXShift(want - note.getAbsoluteX());
        });
      }
      voices.forEach((voice, staff) => voice.draw(context, staff === 0 ? treble : bass));

      x += barWidth;
    }
  });

  // Normally drawn at the size it is shown, so nothing is scaled and the
  // lines stay crisp. On a screen too short for even one system — a phone
  // held sideways — it is drawn whole and scaled down to fit instead, which
  // is better than drawing it full size and cutting the top off.
  const svg = host.querySelector('svg');
  if (svg) {
    // VexFlow sets an inline width and height as well as the attributes, and
    // an inline size wins over a viewBox — so the scaling would do nothing
    // at all while looking as though it should work.
    svg.style.removeProperty('width');
    svg.style.removeProperty('height');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  }
  void room;
}

/**
 * Free play, written out.
 *
 * The page fills from the left as you play, four bars to a line, and turns
 * a line at a time when it is full. How many lines it shows depends on the
 * room it has: on a phone that may be one, on a desktop four.
 */
export function LiveSheet({
  moments,
  fifths = 0,
  accidentals = 'auto',
  splitPoint,
  barsPerLine = 4,
  beatsPerBar = 4,
}: LiveSheetProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 720, height: 420 });
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<SheetState>(EMPTY_SHEET);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () =>
      setBox({
        width: Math.max(MIN_WIDTH, element.clientWidth),
        // No floor worth speaking of: a box too short for a system is
        // drawn whole and scaled down, and a floor here would hide the real
        // height from the arithmetic that does the scaling.
        height: Math.max(48, element.clientHeight),
      });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const room = box.height - MARGIN_TOP - MARGIN_BOTTOM;
  const bars = box.width < NARROW ? Math.max(1, Math.round(barsPerLine / 2)) : barsPerLine;
  const lines = Math.max(1, Math.min(MOST_LINES, Math.floor(room / SYSTEM_HEIGHT)));
  // Whatever is left over is shared between the systems rather than left as
  // a blank half of the panel.
  const systemHeight = Math.min(SYSTEM_HEIGHT * MOST_STRETCH, Math.max(SYSTEM_HEIGHT, room / lines));
  const natural = MARGIN_TOP + lines * systemHeight + MARGIN_BOTTOM;
  /*
   * Normally the sheet is drawn at the size it is shown. On a screen too
   * short for even one system — a phone held sideways — it has to be scaled
   * down to fit, and scaling it down would leave it in a narrow column in
   * the middle of a wide panel. So it is drawn *wider* by the same factor it
   * is about to be shrunk by, and comes out the width of the panel with the
   * bars spread across it: the notes are no bigger either way, but there is
   * room between them instead of empty page on both sides.
   */
  const drawWidth =
    natural > box.height ? Math.round((box.width * natural) / box.height) : box.width;

  // The sheet itself is kept in a ref and folded forward: it holds more than
  // the trail does — the trail forgets by time, the page by room — so it
  // cannot be derived from the moments on hand alone.
  const layout = useMemo(() => {
    sheet.current = restartWhenEmpty(sheet.current, moments);
    sheet.current = writeMoments(sheet.current, moments, MOST_LINES * bars * beatsPerBar);
    return sheetRows(sheet.current, { barsPerLine: bars, beatsPerBar, lines });
  }, [moments, bars, beatsPerBar, lines]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      draw(host, drawWidth, box.height, {
        layout,
        lines,
        fifths,
        accidentals,
        splitPoint,
        barsPerLine: bars,
        beatsPerBar,
        systemHeight,
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [layout, drawWidth, box.height, lines, systemHeight, fifths, accidentals, splitPoint, bars, beatsPerBar]);

  return (
    <div className="staff staff--live" ref={boxRef}>
      <div ref={hostRef} className="staff__canvas" aria-label="What you have played" role="img" />
      {error && <p className="staff__error">Could not draw the staff: {error}</p>}
    </div>
  );
}
