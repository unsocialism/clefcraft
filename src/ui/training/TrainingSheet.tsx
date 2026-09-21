import { useEffect, useRef, useState } from 'react';
import {
  Accidental,
  BarlineType,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
} from 'vexflow';

import { keySignatureByFifths } from '../../core/music/keySignature.ts';
import type { Exercise, GeneratedNote, TrainingClef } from '../../core/training/generator.ts';
import { keepInView } from '../keepInView.ts';

/* Layout, in pixels. VexFlow puts a stave's top line 40px below the y it is
 * given, and the lines span 40px — so a stave drawn at y occupies y+40 to
 * y+80, with room above for two ledger lines and a stem. */
const STAVE_GAP = 118; // treble y → bass y
const LINE_GAP = 8; // extra space between lines of music
const ONE_STAFF_HEIGHT = 128;
const TWO_STAFF_HEIGHT = ONE_STAFF_HEIGHT + STAVE_GAP;
const SIDE_MARGIN = 12;
/** Clef, key signature and time signature, on the first bar of a line. */
const FIRST_BAR_EXTRA = 78;
const KEY_EXTRA_PER_ACCIDENTAL = 10;
/** Below this width four bars are too cramped to read; two per line instead. */
const NARROW = 600;
const MIN_WIDTH = 300;
/**
 * VexFlow draws with 10px between staff lines, which is small print on a
 * large screen. The exercise is drawn at this width and scaled up to fill
 * the space, to at most this much — beyond that, a bigger staff stops being
 * easier to read and starts crowding the keyboard.
 */
const DRAWN_WIDTH = 820;
const MAX_SCALE = 1.7;

// Colours drawn into the SVG. Engraving stays on a light "paper" in both
// colour schemes, so these are fixed rather than theme tokens.
const INK = '#16191d';
const RIGHT = '#2f6df6';
const LEFT = '#e07b00';
const WRONG = '#d6336c';
const DONE_CLEAN = '#2b8a3e';
const DONE_MISSED = '#c2410c';
const NOW_BG_RIGHT = 'rgba(47, 109, 246, 0.13)';
const NOW_BG_LEFT = 'rgba(240, 140, 0, 0.16)';
const NOW_BG_WRONG = 'rgba(214, 51, 108, 0.16)';
const NOW_BG_BOTH = 'rgba(92, 104, 128, 0.13)';

export interface TrainingSheetProps {
  readonly exercise: Exercise;
  /** The event to play now; equal to the event count when finished. */
  readonly currentIndex: number;
  /** A wrong key has been pressed on the current note. */
  readonly wrongNow: boolean;
  /** Notes that took more than one attempt. */
  readonly missed: ReadonlySet<number>;
  /** Keep the current note in view as the exercise moves on. */
  readonly follow?: boolean;
}

function colourFor(index: number, note: GeneratedNote, props: TrainingSheetProps): string {
  // `index` is the event: both notes of an interval share its colour.
  if (index < props.currentIndex) return props.missed.has(index) ? DONE_MISSED : DONE_CLEAN;
  if (index === props.currentIndex) {
    if (props.wrongNow) return WRONG;
    return note.staff === 1 ? RIGHT : LEFT;
  }
  return INK;
}

function vexKey(note: GeneratedNote): string {
  return `${note.step.toLowerCase()}/${note.octave}`;
}

/** A bar's worth of notes for one stave, or a whole-bar rest. */
function barNotes(
  exercise: Exercise,
  measure: number,
  clef: TrainingClef,
  props: TrainingSheetProps,
  drawn: Map<number, StaveNote[]>,
): StaveNote[] {
  const staff = clef === 'treble' ? 1 : 2;
  // One stave note per beat, holding one key or the two of an interval.
  // The generator lists an interval's notes lowest first, which is the
  // order VexFlow wants its keys in.
  const beats = new Map<number, GeneratedNote[]>();
  for (const note of exercise.notes) {
    if (note.measure !== measure || note.staff !== staff) continue;
    beats.set(note.event, [...(beats.get(note.event) ?? []), note]);
  }

  if (beats.size === 0) {
    const rest = new StaveNote({
      // A whole rest hangs from the fourth line.
      keys: [clef === 'treble' ? 'd/5' : 'f/3'],
      duration: 'wr',
      clef,
      align_center: true,
    });
    rest.setStyle({ fillStyle: '#8a9099', strokeStyle: '#8a9099' });
    return [rest];
  }

  return [...beats].map(([index, notes]) => {
    const staveNote = new StaveNote({ keys: notes.map(vexKey), duration: 'q', clef, auto_stem: true });
    notes.forEach((note, k) => {
      if (note.accidental) staveNote.addModifier(new Accidental(note.accidental), k);
    });
    const colour = colourFor(index, notes[0]!, props);
    staveNote.setStyle({ fillStyle: colour, strokeStyle: colour });
    // Ledger lines in the note's colour read as part of the note; left
    // black they look like a second, unrelated mark.
    staveNote.setLedgerLineStyle({ fillStyle: colour, strokeStyle: colour });
    // A both-hands beat has a stave note on each staff; keep them all.
    drawn.set(index, [...(drawn.get(index) ?? []), staveNote]);
    return staveNote;
  });
}

function draw(host: HTMLDivElement, shownWidth: number, props: TrainingSheetProps): void {
  host.replaceChildren();
  const scale = Math.min(MAX_SCALE, Math.max(1, shownWidth / DRAWN_WIDTH));
  const width = shownWidth / scale;
  const { exercise } = props;
  const clefs: TrainingClef[] = exercise.notes.some((n) => n.staff === 2)
    ? exercise.notes.some((n) => n.staff === 1)
      ? ['treble', 'bass']
      : ['bass']
    : ['treble'];
  const grand = clefs.length === 2;

  const barsPerLine = width < NARROW ? Math.min(2, exercise.bars) : exercise.bars;
  const lines = Math.ceil(exercise.bars / barsPerLine);
  const lineHeight = (grand ? TWO_STAFF_HEIGHT : ONE_STAFF_HEIGHT) + LINE_GAP;
  const height = lines * lineHeight;

  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();

  const key = keySignatureByFifths(exercise.fifths);
  const leadIn = FIRST_BAR_EXTRA + Math.abs(exercise.fifths) * KEY_EXTRA_PER_ACCIDENTAL;
  const usable = width - SIDE_MARGIN * 2;
  const drawn = new Map<number, StaveNote[]>();

  for (let line = 0; line < lines; line++) {
    const firstBar = line * barsPerLine + 1;
    const lastBar = Math.min(exercise.bars, firstBar + barsPerLine - 1);
    // Every bar the same width for its notes; the first carries the clef too.
    const barWidth = (usable - leadIn) / barsPerLine;
    const top = line * lineHeight;
    let x = SIDE_MARGIN;

    for (let measure = firstBar; measure <= lastBar; measure++) {
      const isLineStart = measure === firstBar;
      const w = barWidth + (isLineStart ? leadIn : 0);
      const staves = clefs.map((clef, i) => {
        const stave = new Stave(x, top + i * STAVE_GAP, w);
        if (isLineStart) {
          stave.addClef(clef).addKeySignature(key.vexflow);
          if (line === 0) stave.addTimeSignature(`${exercise.beatsPerBar}/4`);
        }
        if (measure === exercise.bars) stave.setEndBarType(BarlineType.END);
        stave.setContext(context).draw();
        return stave;
      });

      if (grand) {
        const [treble, bass] = staves as [Stave, Stave];
        if (isLineStart) {
          new StaveConnector(treble, bass).setType('brace').setContext(context).draw();
          new StaveConnector(treble, bass).setType('singleLeft').setContext(context).draw();
        }
        new StaveConnector(treble, bass)
          .setType(measure === exercise.bars ? 'boldDoubleRight' : 'singleRight')
          .setContext(context)
          .draw();
      }

      staves.forEach((stave, i) => {
        const notes = barNotes(exercise, measure, clefs[i]!, props, drawn);
        Formatter.FormatAndDraw(context, stave, notes);
      });

      x += w;
    }
  }

  // A soft band behind the note to play now, so it can be found at a glance
  // — the notehead colour alone is easy to lose among sixteen others.
  const svg = host.querySelector('svg');
  // Scaled by the viewBox rather than by drawing larger, so the layout
  // above stays in VexFlow's own units.
  svg?.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // VexFlow sizes the SVG with inline styles too, which would pin it at
  // the drawn size whatever the attributes say.
  svg?.style.removeProperty('width');
  svg?.style.removeProperty('height');
  svg?.setAttribute('width', String(shownWidth));
  svg?.setAttribute('height', String(height * scale));

  const now = drawn.get(props.currentIndex);
  if (now?.length && svg) {
    // One band around everything due now — across both staves when both
    // hands play, so it reads as a single thing to press.
    const boxes = now.map((n) => n.getBoundingBox());
    const left = Math.min(...boxes.map((b) => b.getX()));
    const top = Math.min(...boxes.map((b) => b.getY()));
    const right = Math.max(...boxes.map((b) => b.getX() + b.getW()));
    const bottom = Math.max(...boxes.map((b) => b.getY() + b.getH()));
    const staves = new Set(
      exercise.notes.filter((n) => n.event === props.currentIndex).map((n) => n.staff),
    );
    const pad = 7;
    const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    band.setAttribute('x', String(left - pad));
    band.setAttribute('y', String(top - pad));
    band.setAttribute('width', String(right - left + pad * 2));
    band.setAttribute('height', String(bottom - top + pad * 2));
    band.setAttribute('rx', '8');
    band.setAttribute(
      'fill',
      props.wrongNow
        ? NOW_BG_WRONG
        : staves.size > 1
          ? NOW_BG_BOTH
          : staves.has(1)
            ? NOW_BG_RIGHT
            : NOW_BG_LEFT,
    );
    band.setAttribute('class', 'training-sheet__now');
    svg.insertBefore(band, svg.firstChild);
  }
}

/**
 * A generated exercise, engraved: one line of four bars, or two lines of two
 * on a narrow screen. Played notes turn green, or orange if they took more
 * than one try; the note to play now is in its hand's colour, and pink while
 * a wrong key is down.
 */
export function TrainingSheet(props: TrainingSheetProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [renderError, setRenderError] = useState<string | null>(null);

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

  const { exercise, currentIndex, wrongNow, missed, follow } = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      draw(host, width, { exercise, currentIndex, wrongNow, missed });
      setRenderError(null);
    } catch (cause) {
      setRenderError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [exercise, currentIndex, wrongNow, missed, width]);

  // On a small screen in landscape the second line of music may be below
  // the fold; bring the current note into view when it moves there.
  useEffect(() => {
    if (!follow) return;
    keepInView(hostRef.current?.querySelector('.training-sheet__now'));
  }, [follow, currentIndex, width, exercise]);

  return (
    <div className="staff training-sheet">
      <div
        ref={hostRef}
        className="staff__canvas training-sheet__canvas"
        role="img"
        aria-label="Reading exercise"
      />
      {renderError && <p className="staff__error">Could not draw the exercise: {renderError}</p>}
    </div>
  );
}
