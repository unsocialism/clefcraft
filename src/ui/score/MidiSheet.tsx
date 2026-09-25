import { useEffect, useRef, useState } from 'react';
import {
  Accidental,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow';

import { keySignatureByFifths } from '../../core/music/keySignature.ts';
import type { ClockReading } from '../../core/score/clock.ts';
import type { EngravedEntry, EngravedMeasure, MidiScore } from '../../core/score/midiScore.ts';
import { keepInView } from '../keepInView.ts';
import {
  anchorsFrom,
  playheadAt,
  type Anchor,
  type MappedBar,
  type PlayheadSpot,
  type TimeMap,
} from './playhead.ts';

/* Layout in VexFlow's own units; the whole sheet is scaled to the width it
 * is given, the same way the training sheet is. */
const STAVE_GAP = 108;
const LINE_HEIGHT = 250;
const SIDE_MARGIN = 10;
/** Clef, key and time signature at the start of a line. */
const LEAD_IN = 70;
const KEY_WIDTH = 10;
const DRAWN_WIDTH = 900;
const MAX_SCALE = 1.5;
const MIN_WIDTH = 300;
/** Room inside a bar that the notes themselves do not account for. */
const BAR_PADDING = 16;

const INK = '#16191d';
const RIGHT = '#2f6df6';
const LEFT = '#e07b00';
const NOW_BG_RIGHT = 'rgba(47, 109, 246, 0.13)';
const NOW_BG_LEFT = 'rgba(240, 140, 0, 0.16)';
const NOW_BG_BOTH = 'rgba(92, 104, 128, 0.13)';
const PLAYHEAD = 'rgba(124, 58, 237, 0.6)';
const PLAYHEAD_WIDTH = 3;
/** Room above the treble staff and below the bass staff for the line. */
const PLAYHEAD_OVERHANG = 14;

export interface MidiSheetProps {
  readonly midiScore: MidiScore;
  /** The practice event due now, or null when the piece is finished. */
  readonly currentEvent: number | null;
  /** Scroll the current bar into view as it moves. */
  readonly follow?: boolean;
  /**
   * The play-along clock. While it is running a line sweeps the music in
   * time with it, so the beat can be seen coming rather than inferred from
   * the note that just went past.
   */
  readonly clock?: { readonly current: ClockReading } | null;
  readonly playing?: boolean;
}

function keysOf(entry: EngravedEntry, clef: 'treble' | 'bass'): string[] {
  if (entry.rest) return [clef === 'treble' ? 'd/5' : 'f/3'];
  return entry.notes.map((n) => `${n.step.toLowerCase()}/${n.octave}`);
}

function buildNote(entry: EngravedEntry, clef: 'treble' | 'bass', colour: string): StaveNote {
  const note = new StaveNote({
    keys: keysOf(entry, clef),
    duration: entry.rest ? `${entry.duration}r` : entry.duration,
    clef,
    auto_stem: !entry.rest,
    align_center: entry.rest && entry.duration === 'w',
    // The dots have to be declared here, not only drawn below: `Dot` adds
    // the glyph but not the time it stands for, so a dotted note left to it
    // alone counts as undotted and every note after it in that hand is
    // formatted half a beat early — the two staves come apart on the page.
    dots: entry.dots,
  });
  if (!entry.rest) {
    entry.notes.forEach((n, i) => {
      if (n.alter === 1) note.addModifier(new Accidental('#'), i);
      else if (n.alter === -1) note.addModifier(new Accidental('b'), i);
    });
  }
  for (let d = 0; d < entry.dots; d++) Dot.buildAndAttach([note], { all: true });
  note.setStyle({ fillStyle: colour, strokeStyle: colour });
  note.setLedgerLineStyle({ fillStyle: colour, strokeStyle: colour });
  return note;
}

interface Drawn {
  readonly note: StaveNote;
  readonly entry: EngravedEntry;
  readonly staff: 0 | 1;
}

/** Where each event was drawn, so the band can find it later. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly staves: ReadonlySet<0 | 1>;
}

/** One bar, built but not yet placed on the page. */
interface Built {
  readonly measure: EngravedMeasure;
  readonly index: number;
  readonly voices: readonly [Voice, Voice];
  readonly notes: readonly [StaveNote[], StaveNote[]];
  /** The room its contents need, before any stretching. */
  readonly minWidth: number;
}

function buildBar(measure: EngravedMeasure, index: number): Built {
  const voices: Voice[] = [];
  const notes: StaveNote[][] = [];
  ([0, 1] as const).forEach((staff) => {
    const clef = staff === 0 ? 'treble' : 'bass';
    const built = measure.staves[staff].map((entry) =>
      buildNote(entry, clef, entry.eventIndex === null ? INK : staff === 0 ? RIGHT : LEFT),
    );
    notes.push(built);
    voices.push(
      new Voice({ num_beats: measure.beats, beat_value: measure.beatType })
        .setMode(Voice.Mode.SOFT)
        .addTickables(built),
    );
  });
  const pair = [voices[0]!, voices[1]!] as const;
  const minWidth = new Formatter().joinVoices([...pair]).preCalculateMinTotalWidth([...pair]);
  return {
    measure,
    index,
    voices: pair,
    notes: [notes[0]!, notes[1]!] as const,
    minWidth: minWidth + BAR_PADDING,
  };
}

interface Engraving {
  readonly spots: Map<number, Spot>;
  /** Where each moment of music ended up, for the sweeping line. */
  readonly times: TimeMap;
}

function draw(host: HTMLDivElement, shownWidth: number, midiScore: MidiScore): Engraving {
  host.replaceChildren();
  const key = keySignatureByFifths(midiScore.fifths);
  const leadIn = LEAD_IN + Math.abs(midiScore.fifths) * KEY_WIDTH;

  // Build every bar first, so each one's real width is known, then break
  // the lines where they actually fill up. Guessing a fixed number of bars
  // per line is what makes a bar of sixteenths spill off the page.
  const built = midiScore.measures.map((measure, index) => buildBar(measure, index));

  // The page is drawn in VexFlow's units and scaled to the space available.
  // A bar too wide to fit even on its own widens the page instead, which
  // comes out as smaller print rather than notes running off the edge.
  const widest = built.reduce((max, bar) => Math.max(max, bar.minWidth), 0) + leadIn + SIDE_MARGIN * 2;
  const width = Math.max(shownWidth / Math.min(MAX_SCALE, Math.max(1, shownWidth / DRAWN_WIDTH)), widest);
  const scale = shownWidth / width;
  const usable = width - SIDE_MARGIN * 2;
  const lines: Built[][] = [];
  let current: Built[] = [];
  let used = leadIn;
  for (const bar of built) {
    if (current.length > 0 && used + bar.minWidth > usable) {
      lines.push(current);
      current = [];
      used = leadIn;
    }
    current.push(bar);
    used += bar.minWidth;
  }
  if (current.length > 0) lines.push(current);

  const height = Math.max(1, lines.length) * LINE_HEIGHT;
  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const context = renderer.getContext();

  const drawn = new Map<number, Drawn[]>();
  /** Each bar as it was drawn, before the bars are joined up into a map. */
  const laidOut: {
    line: number;
    startQuarters: number;
    endQuarters: number;
    top: number;
    bottom: number;
    barlineX: number;
    points: Anchor[];
  }[] = [];
  // The note at the end of the previous bar, per staff, when it is tied
  // into this one. A tie cannot cross a line, so it is dropped there.
  let pendingTies: (StaveNote | null)[] = [null, null];

  lines.forEach((bars, line) => {
    pendingTies = [null, null];
    const top = line * LINE_HEIGHT + 10;
    const spare = Math.max(0, usable - leadIn - bars.reduce((sum, bar) => sum + bar.minWidth, 0));
    const share = bars.reduce((sum, bar) => sum + bar.minWidth, 0);
    let x = SIDE_MARGIN;

    bars.forEach((bar, index) => {
      const lineStart = index === 0;
      // Spare room is shared out in proportion to what each bar holds, the
      // way an engraver spaces them: a bar of one whole note does not need
      // the room a bar of sixteenths does.
      const w = bar.minWidth + (share > 0 ? (spare * bar.minWidth) / share : 0) + (lineStart ? leadIn : 0);
      const staves = ([0, 1] as const).map((staff) => {
        const stave = new Stave(x, top + staff * STAVE_GAP, w);
        if (lineStart) {
          stave.addClef(staff === 0 ? 'treble' : 'bass').addKeySignature(key.vexflow);
        }
        const before = midiScore.measures[bar.index - 1];
        if (
          lineStart ||
          !before ||
          before.beats !== bar.measure.beats ||
          before.beatType !== bar.measure.beatType
        ) {
          stave.addTimeSignature(`${bar.measure.beats}/${bar.measure.beatType}`);
        }
        stave.setContext(context).draw();
        return stave;
      });

      const [treble, bass] = staves as [Stave, Stave];
      if (lineStart) {
        new StaveConnector(treble, bass).setType('brace').setContext(context).draw();
        new StaveConnector(treble, bass).setType('singleLeft').setContext(context).draw();
      }
      new StaveConnector(treble, bass)
        .setType(bar.index === midiScore.measures.length - 1 ? 'boldDoubleRight' : 'singleRight')
        .setContext(context)
        .draw();

      const beams: Beam[] = [];
      const ties: { from: StaveNote; to: StaveNote }[] = [];
      ([0, 1] as const).forEach((staff) => {
        const notes = bar.notes[staff];
        const entries = bar.measure.staves[staff];
        const stave = staff === 0 ? treble : bass;
        for (const note of notes) note.setStave(stave);
        bar.voices[staff].setStave(stave);
        // Rests are handed in too, with beaming across them turned off, so
        // a beam breaks where the music does; the groups come from the time
        // signature, so 6/8 beams in threes and 4/4 in twos.
        beams.push(
          ...Beam.generateBeams(notes, {
            beam_rests: false,
            groups: Beam.getDefaultBeamGroups(`${bar.measure.beats}/${bar.measure.beatType}`),
          }),
        );
        entries.forEach((entry, i) => {
          const next = notes[i + 1];
          if (entry.tieToNext && next) ties.push({ from: notes[i]!, to: next });
        });
        const waiting = pendingTies[staff];
        const first = notes[0];
        if (waiting && !lineStart && first) ties.push({ from: waiting, to: first });
        const carriesOver = entries[entries.length - 1]?.tieToNext ?? false;
        pendingTies[staff] = carriesOver ? (notes[notes.length - 1] ?? null) : null;

        for (const [i, entry] of entries.entries()) {
          if (entry.eventIndex === null) continue;
          const note = notes[i]!;
          drawn.set(entry.eventIndex, [
            ...(drawn.get(entry.eventIndex) ?? []),
            { note, entry, staff },
          ]);
        }
      });

      const pair = [bar.voices[0], bar.voices[1]];
      new Formatter()
        .joinVoices(pair)
        .format(pair, w - (lineStart ? leadIn : 0) - BAR_PADDING);
      pair.forEach((voice, i) => voice.draw(context, i === 0 ? treble : bass));
      for (const beam of beams) beam.setContext(context).draw();
      for (const tie of ties) {
        new StaveTie({ first_note: tie.from, last_note: tie.to }).setContext(context).draw();
      }

      // Where this bar's moments landed. Read after formatting, because that
      // is when the notes acquire the positions they are drawn at.
      const points: Anchor[] = [];
      ([0, 1] as const).forEach((staff) => {
        bar.measure.staves[staff].forEach((entry, i) => {
          const note = bar.notes[staff][i];
          if (note) points.push({ quarters: entry.onsetQuarters, x: note.getAbsoluteX() });
        });
      });
      const barStart =
        bar.measure.staves[0][0]?.onsetQuarters ?? bar.measure.staves[1][0]?.onsetQuarters ?? 0;
      const barLength = (bar.measure.beats * 4) / bar.measure.beatType;
      laidOut.push({
        line,
        startQuarters: barStart,
        endQuarters: barStart + barLength,
        top: treble.getYForLine(0) - PLAYHEAD_OVERHANG,
        bottom: bass.getYForLine(4) + PLAYHEAD_OVERHANG,
        barlineX: x + w,
        points,
      });

      x += w;
    });
  });

  const svg = host.querySelector('svg');
  svg?.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg?.style.removeProperty('width');
  svg?.style.removeProperty('height');
  svg?.setAttribute('width', String(shownWidth));
  svg?.setAttribute('height', String(height * scale));

  const spots = new Map<number, Spot>();
  for (const [event, items] of drawn) {
    const boxes = items.map((item) => item.note.getBoundingBox());
    const left = Math.min(...boxes.map((b) => b.getX()));
    const top = Math.min(...boxes.map((b) => b.getY()));
    const right = Math.max(...boxes.map((b) => b.getX() + b.getW()));
    const bottom = Math.max(...boxes.map((b) => b.getY() + b.getH()));
    spots.set(event, {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      staves: new Set(items.map((item) => item.staff)),
    });
  }
  // Join the bars up. A bar hands the line to the first note of the bar
  // after it, so the sweep crosses the barline without a jump; at the end of
  // a line it stops at the barline instead, because the next bar is not
  // beside it but below it.
  const firstNoteX = (points: readonly Anchor[]): number | null => {
    let best: Anchor | null = null;
    for (const point of points) {
      if (!Number.isFinite(point.x)) continue;
      if (!best || point.quarters < best.quarters || (point.quarters === best.quarters && point.x < best.x)) {
        best = point;
      }
    }
    return best?.x ?? null;
  };
  const times: MappedBar[] = laidOut.map((bar, index) => {
    const next = laidOut[index + 1];
    const handover = next && next.line === bar.line ? firstNoteX(next.points) : null;
    return {
      startQuarters: bar.startQuarters,
      endQuarters: bar.endQuarters,
      top: bar.top,
      bottom: bar.bottom,
      anchors: anchorsFrom(bar.points, {
        quarters: bar.endQuarters,
        x: handover ?? bar.barlineX,
      }),
    };
  });
  times.sort((a, b) => a.startQuarters - b.startQuarters);
  return { spots, times };
}

/**
 * Put the "play this now" band where the current event was drawn.
 *
 * Separate from drawing the music, and deliberately: re-engraving a whole
 * piece for every note would make a fast passage crawl, while moving one
 * rectangle costs nothing.
 */
function placeBand(host: HTMLDivElement, spot: Spot | undefined): void {
  const svg = host.querySelector('svg');
  if (!svg) return;
  const existing = svg.querySelector('.midi-sheet__now');
  if (!spot) {
    existing?.remove();
    return;
  }
  const band = existing ?? document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const pad = 6;
  band.setAttribute('x', String(spot.x - pad));
  band.setAttribute('y', String(spot.y - pad));
  band.setAttribute('width', String(spot.width + pad * 2));
  band.setAttribute('height', String(spot.height + pad * 2));
  band.setAttribute('rx', '7');
  band.setAttribute(
    'fill',
    spot.staves.size > 1 ? NOW_BG_BOTH : spot.staves.has(0) ? NOW_BG_RIGHT : NOW_BG_LEFT,
  );
  band.setAttribute('class', 'midi-sheet__now');
  if (!existing) svg.insertBefore(band, svg.firstChild);
}

/**
 * Put the sweeping line where the clock says the music is.
 *
 * Like the band, this moves an element that is already on the page rather
 * than drawing anything: it runs every frame, and re-rendering for it would
 * be sixty renders a second of a piece that has not changed.
 */
/**
 * Where the line stands, counting in included.
 *
 * Through the count-in it does not wait at the first note: it runs up to it,
 * arriving exactly on the downbeat, so the count is something you see as
 * well as read. Where there is music before the first note on the same line,
 * it runs up through that music at the speed it is about to keep — a bar of
 * count-in is a bar of travel — which is what makes the arrival feel like a
 * conductor's upbeat rather than a jump. Where there is not, because the
 * piece starts here or the bar before is on the line above, it comes in from
 * the left edge instead, still arriving on the beat.
 */
function playheadSpot(times: TimeMap, reading: ClockReading): PlayheadSpot | null {
  const target = playheadAt(times, reading.quarters);
  if (!target || !reading.countingIn || reading.countInQuarters <= 0) return target;

  const runUpFrom = reading.quarters - reading.countInQuarters;
  const at = runUpFrom + reading.countInQuarters * reading.countInProgress;
  const firstBar = times[0]?.startQuarters ?? 0;
  if (runUpFrom >= firstBar) {
    const walked = playheadAt(times, at);
    // Only along this line: the bar before may be on the line above, and a
    // line that runs up there and jumps back down reads as a mistake.
    if (walked && walked.top === target.top) return walked;
  }
  const from = SIDE_MARGIN;
  return {
    x: from + (target.x - from) * reading.countInProgress,
    top: target.top,
    bottom: target.bottom,
  };
}

function placePlayhead(
  host: HTMLDivElement,
  times: TimeMap,
  reading: ClockReading | null,
): void {
  const svg = host.querySelector('svg');
  if (!svg) return;
  const existing = svg.querySelector('.midi-sheet__playhead');
  const spot = reading ? playheadSpot(times, reading) : null;
  if (!spot) {
    existing?.remove();
    return;
  }
  const line = existing ?? document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  line.setAttribute('x', String(spot.x - PLAYHEAD_WIDTH / 2));
  line.setAttribute('y', String(spot.top));
  line.setAttribute('width', String(PLAYHEAD_WIDTH));
  line.setAttribute('height', String(Math.max(1, spot.bottom - spot.top)));
  line.setAttribute('rx', String(PLAYHEAD_WIDTH / 2));
  line.setAttribute('fill', PLAYHEAD);
  // Counting in, it is still on its way in: drawn a little lighter, so it
  // is clear the music has not started yet.
  line.setAttribute(
    'class',
    reading?.countingIn ? 'midi-sheet__playhead midi-sheet__playhead--count' : 'midi-sheet__playhead',
  );
  if (!existing) svg.appendChild(line);
}

/**
 * A MIDI file engraved.
 *
 * Drawing every bar of a long piece at once is what makes following it
 * possible — the page scrolls, the music does not reflow — and VexFlow is
 * fast enough for that at the sizes a piano piece reaches. What it cannot
 * do is redraw on every keypress, so the sheet is rebuilt only when the
 * *bar* changes, not the note: the band that marks what is due now moves
 * within a bar without touching the engraving.
 */
export function MidiSheet({
  midiScore,
  currentEvent,
  follow = false,
  clock = null,
  playing = false,
}: MidiSheetProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const spotsRef = useRef<Map<number, Spot>>(new Map());
  const timesRef = useRef<TimeMap>([]);
  const [width, setWidth] = useState(900);
  const [error, setError] = useState<string | null>(null);

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

  // The music is engraved when the piece or the width changes, and only
  // then. Which note is due moves the band, below.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      const engraving = draw(host, width, midiScore);
      spotsRef.current = engraving.spots;
      timesRef.current = engraving.times;
      setError(null);
    } catch (cause) {
      spotsRef.current = new Map();
      timesRef.current = [];
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [midiScore, width]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    placeBand(host, currentEvent === null ? undefined : spotsRef.current.get(currentEvent));
    if (follow) keepInView(host.querySelector('.midi-sheet__now'));
  }, [currentEvent, follow, width, midiScore, error]);

  // The sweeping line, driven by the clock rather than by React: it reads
  // the position every frame and moves one rectangle.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!clock || !playing) {
      placePlayhead(host, timesRef.current, null);
      return;
    }
    let frame = 0;
    const tick = () => {
      placePlayhead(host, timesRef.current, clock.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      const still = hostRef.current;
      if (still) placePlayhead(still, timesRef.current, null);
    };
  }, [clock, playing, width, midiScore, error]);

  return (
    <div className="staff midi-sheet">
      <div ref={hostRef} className="staff__canvas midi-sheet__canvas" role="img" aria-label="Score" />
      {error && <p className="staff__error">Could not draw the score: {error}</p>}
    </div>
  );
}
