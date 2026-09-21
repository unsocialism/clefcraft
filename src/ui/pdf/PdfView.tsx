import { useEffect, useMemo, useRef, useState } from 'react';
// The legacy build, not the default one. pdf.js's modern build calls very
// recent JS APIs (Map.prototype.getOrInsertComputed among them) that Chrome
// only gained lately; on anything older the second page of a document fails
// to render with an unhelpful error. The legacy build ships the polyfills
// and behaves identically otherwise.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite resolves this to a URL for the worker bundle.
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import type { EditedNote } from '../../core/pdf/edits.ts';
import { readPdfNotes, type PdfNote, type PdfReadResult } from '../../core/pdf/pdfNotes.ts';
import { keepInView } from '../keepInView.ts';

pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker;

export interface PdfViewProps {
  readonly data: ArrayBuffer | null;
  readonly fileName: string | null;
  /** Page width in CSS pixels; pages are rendered to fit. */
  readonly zoom: number;
  /** Draw a marker on every notehead the reader found. */
  readonly showOverlay: boolean;
  /** Label each marker with the pitch that was read. */
  readonly showPitches: boolean;
  /** Notes to call out as "play these now", by their position on the page. */
  readonly highlight: readonly {
    page: number;
    x: number;
    ys: readonly number[];
    staves?: readonly number[];
  }[];
  onRead(result: PdfReadResult): void;
  onError(message: string): void;
  /**
   * The notes to mark, corrections applied. When absent the reader's own
   * notes are shown, as they came off the page.
   */
  readonly notes?: readonly EditedNote[];
  /** Correction mode: markers become buttons and the page takes clicks. */
  readonly editing?: boolean;
  readonly selectedId?: string | null;
  onSelect?(id: string | null): void;
  /** A click on the page, in PDF coordinates, asking for a note there. */
  onAddAt?(page: number, x: number, y: number): void;
  onEditAction?(id: string, action: EditAction): void;
  /** Scroll the page along so the notes due now stay on screen. */
  readonly follow?: boolean;
}

export type EditAction = 'down' | 'up' | 'octaveDown' | 'octaveUp' | 'hand' | 'delete';

interface PageBox {
  readonly pageNumber: number;
  /** Page size in PDF units, for the overlay's coordinate system. */
  readonly width: number;
  readonly height: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** PDF point to overlay point — this is what handles a rotated page. */
  toOverlay(x: number, y: number): readonly [number, number];
  /** And back again, for turning a click into a position on the page. */
  toPdf(x: number, y: number): readonly [number, number];
}

/**
 * Renders every page of a PDF, with the reader's findings drawn on top.
 *
 * The overlay is the only honest way to check a PDF reading. A list of
 * pitches can be wrong in ways that look perfectly reasonable — an octave
 * out, a clef change missed, a whole staff shifted — and you would never
 * know from reading the list. Put a marker on each notehead with the pitch
 * beside it and a wrong reading is obvious at a glance.
 *
 * Pages are drawn to canvases at the device pixel ratio so engraved music
 * stays crisp: a staff line is one pixel, and rendering at CSS resolution
 * makes it disappear at some zoom levels.
 */
export function PdfView({
  data,
  fileName,
  zoom,
  showOverlay,
  showPitches,
  highlight,
  onRead,
  onError,
  notes: editedNotes,
  editing = false,
  selectedId = null,
  onSelect,
  onAddAt,
  onEditAction,
  follow = false,
}: PdfViewProps) {
  const [boxes, setBoxes] = useState<readonly PageBox[]>([]);
  const [readNotes, setNotes] = useState<readonly PdfNote[]>([]);
  const [rendering, setRendering] = useState(false);
  const [reading, setReading] = useState(false);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());

  // Held in a ref so a new callback identity cannot retrigger a re-read of
  // the whole document.
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Two effects, deliberately. Opening and reading the document is the
  // expensive part and depends only on the file; re-reading it when the zoom
  // slider moves would hand the practice engine a brand-new score and throw
  // away your place in the piece.
  type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  const [doc, setDoc] = useState<Doc | null>(null);

  useEffect(() => {
    if (!data) {
      setDoc(null);
      setBoxes([]);
      setNotes([]);
      return;
    }
    let cancelled = false;
    let opened: Doc | null = null;
    setReading(true);

    const run = async () => {
      try {
        // pdf.js takes ownership of the buffer it is given, so hand it a copy
        // and keep the original for re-renders at another zoom level.
        opened = await pdfjs.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) return;
        setDoc(opened);

        const result = await readPdfNotes({
          OPS: pdfjs.OPS,
          numPages: opened.numPages,
          getPage: (n) => opened!.getPage(n),
        });
        if (cancelled) return;
        setNotes(result.notes);
        onReadRef.current(result);
      } catch (cause) {
        if (!cancelled) onErrorRef.current(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setReading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      void opened?.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setRendering(true);

    const run = async () => {
      try {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const next: PageBox[] = [];
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          const page = await doc.getPage(pageNumber);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: zoom / base.width });
          next.push({
            pageNumber,
            width: base.width,
            height: base.height,
            cssWidth: Math.floor(viewport.width),
            cssHeight: Math.floor(viewport.height),
            toOverlay: (x, y) => {
              const [vx, vy] = base.convertToViewportPoint(x, y);
              return [vx, vy] as const;
            },
            toPdf: (x, y) => {
              const [px, py] = base.convertToPdfPoint(x, y);
              return [px, py] as const;
            },
          });
        }
        if (cancelled) return;
        setBoxes(next);

        // Give React a frame to put the canvases in the DOM.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (cancelled) return;

        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          const canvas = canvasRefs.current.get(pageNumber);
          if (!canvas || cancelled) continue;
          const page = await doc.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (zoom / base.width) * ratio });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not get a 2D canvas context');
          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
      } catch (cause) {
        if (!cancelled) onErrorRef.current(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [doc, zoom]);

  // What to draw: the corrected notes when the caller supplies them,
  // otherwise the raw reading with ids made up on the spot.
  const shown: readonly (PdfNote & { id: string; edit: EditedNote['edit'] })[] = useMemo(
    () =>
      editedNotes ??
      readNotes.map((n) => ({ ...n, id: `${n.page}:${n.x}:${n.y}`, edit: 'read' as const })),
    [editedNotes, readNotes],
  );

  const notesByPage = useMemo(() => {
    const map = new Map<number, (typeof shown)[number][]>();
    for (const note of shown) {
      const list = map.get(note.page);
      if (list) list.push(note);
      else map.set(note.page, [note]);
    }
    return map;
  }, [shown]);

  const highlightByPage = useMemo(() => {
    const map = new Map<
      number,
      { x: number; ys: readonly number[]; staves?: readonly number[] }[]
    >();
    for (const spot of highlight) {
      const list = map.get(spot.page);
      if (list) list.push(spot);
      else map.set(spot.page, [spot]);
    }
    return map;
  }, [highlight]);

  // Keyboard shortcuts for the selected note, for working through a piece at
  // a desk. Held in refs so the listener is attached once, not per render.
  const actionRef = useRef(onEditAction);
  actionRef.current = onEditAction;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  useEffect(() => {
    if (!editing || !selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const act = (action: EditAction) => {
        event.preventDefault();
        actionRef.current?.(selectedId, action);
      };
      if (event.key === 'ArrowUp') act(event.shiftKey ? 'octaveUp' : 'up');
      else if (event.key === 'ArrowDown') act(event.shiftKey ? 'octaveDown' : 'down');
      else if (event.key === 'h' || event.key === 'H') act('hand');
      else if (event.key === 'Delete' || event.key === 'Backspace') act('delete');
      else if (event.key === 'Escape') {
        event.preventDefault();
        selectRef.current?.(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, selectedId]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!follow || highlight.length === 0) return;
    keepInView(rootRef.current?.querySelector('.pdf-mark__now'));
  }, [follow, highlight, boxes]);

  return (
    <div className="pdf-view" ref={rootRef}>
      <div className="pdf-view__bar">
        <span>{fileName ?? 'No PDF loaded'}</span>
        {boxes.length > 0 && (
          <span>
            {boxes.length} page{boxes.length === 1 ? '' : 's'}
          </span>
        )}
        {shown.length > 0 && <span>{shown.length} notes</span>}
        {reading && <span>Reading notes…</span>}
        {rendering && <span>Rendering…</span>}
      </div>
      <div className="pdf-view__pages">
        {boxes.map((box) => {
          const pageNotes = notesByPage.get(box.pageNumber) ?? [];
          const selected = pageNotes.find((n) => n.id === selectedId) ?? null;
          return (
            <div
              key={box.pageNumber}
              className="pdf-page"
              style={{ width: `${box.cssWidth}px`, height: `${box.cssHeight}px` }}
            >
              <canvas
                className="pdf-page__canvas"
                aria-label={`Page ${box.pageNumber}`}
                ref={(element) => {
                  if (element) canvasRefs.current.set(box.pageNumber, element);
                  else canvasRefs.current.delete(box.pageNumber);
                }}
              />
              <svg
                className={
                  editing ? 'pdf-page__overlay pdf-page__overlay--editing' : 'pdf-page__overlay'
                }
                viewBox={`0 0 ${box.width} ${box.height}`}
                preserveAspectRatio="none"
                aria-hidden={!editing}
                onClick={(event) => {
                  if (!editing) return;
                  // A click on empty page first closes an open note, and only
                  // a second click adds one — otherwise dismissing the popover
                  // would drop a stray note wherever you happened to tap.
                  if (selectedId) {
                    onSelect?.(null);
                    return;
                  }
                  const rect = event.currentTarget.getBoundingClientRect();
                  const vx = ((event.clientX - rect.left) / rect.width) * box.width;
                  const vy = ((event.clientY - rect.top) / rect.height) * box.height;
                  const [px, py] = box.toPdf(vx, vy);
                  onAddAt?.(box.pageNumber, px, py);
                }}
              >
                {(showOverlay || editing) &&
                  pageNotes.map((note) => {
                    const [x, y] = box.toOverlay(note.centerX, note.y);
                    const isSelected = note.id === selectedId;
                    const classes = [
                      'pdf-mark',
                      note.staff <= 1 ? 'pdf-mark--right' : 'pdf-mark--left',
                      note.positionError > 0.25 ? 'pdf-mark--doubt' : '',
                      note.edit !== 'read' ? `pdf-mark--${note.edit}` : '',
                      isSelected ? 'pdf-mark--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <g
                        key={note.id}
                        className={classes}
                        data-note-id={note.id}
                        onClick={(event) => {
                          if (!editing) return;
                          event.stopPropagation();
                          onSelect?.(isSelected ? null : note.id);
                        }}
                      >
                        {/* A generous invisible target: a notehead is a few
                            pixels across, and on a phone a finger is not. */}
                        {editing && <circle cx={x} cy={y} r={6.5} className="pdf-mark__hit" />}
                        <circle cx={x} cy={y} r={3.4} />
                        {(showPitches || isSelected) && (
                          <text x={x} y={y - 5}>
                            {/* The spelling as engraved, not one re-derived
                                from the MIDI number: the page says F♯, and
                                showing G♭ beside it would look like an error
                                in the reader when it is not. */}
                            {pitchLabel(note.pitch)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                {(highlightByPage.get(box.pageNumber) ?? []).map((spot, index) =>
                  spot.ys.map((sy, j) => {
                    const [x, y] = box.toOverlay(spot.x, sy);
                    return (
                      <circle
                        key={`${index}-${j}`}
                        className={
                          (spot.staves?.[j] ?? 1) <= 1
                            ? 'pdf-mark__now pdf-mark__now--right'
                            : 'pdf-mark__now pdf-mark__now--left'
                        }
                        cx={x}
                        cy={y}
                        r={5.5}
                      />
                    );
                  }),
                )}
              </svg>

              {editing && selected && (
                <NotePopover
                  note={selected}
                  left={(box.toOverlay(selected.centerX, selected.y)[0] / box.width) * box.cssWidth}
                  top={(box.toOverlay(selected.centerX, selected.y)[1] / box.height) * box.cssHeight}
                  onAction={(action) => onEditAction?.(selected.id, action)}
                  onClose={() => onSelect?.(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pitchLabel(pitch: PdfNote['pitch']): string {
  const accidental = pitch.alter === 1 ? '♯' : pitch.alter === -1 ? '♭' : '';
  return `${pitch.step}${accidental}${pitch.octave}`;
}

interface NotePopoverProps {
  readonly note: EditedNote | (PdfNote & { id: string; edit: EditedNote['edit'] });
  /** Position of the note within the page, in CSS pixels. */
  readonly left: number;
  readonly top: number;
  onAction(action: EditAction): void;
  onClose(): void;
}

/**
 * The correction controls for one note, pinned beside it on the page.
 *
 * Buttons rather than a text field: every correction the reader needs is a
 * small nudge — a missed accidental, a wrong octave, the wrong hand — and
 * nudges are faster to tap than a note name is to type, especially on a
 * phone.
 */
function NotePopover({ note, left, top, onAction, onClose }: NotePopoverProps) {
  // Open below the note when it sits near the top of the page, where a
  // popover above it would be cut off.
  const below = top < 90;
  const hand = note.staff <= 1 ? 'Right hand' : 'Left hand';
  const origin =
    note.edit === 'added' ? 'added by you' : note.edit === 'changed' ? 'corrected' : 'as read';

  return (
    <div
      className={below ? 'note-popover note-popover--below' : 'note-popover'}
      style={{ left: `${left}px`, top: `${top}px` }}
      role="dialog"
      aria-label={`Edit ${pitchLabel(note.pitch)}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="note-popover__head">
        <strong>{pitchLabel(note.pitch)}</strong>
        <span className={note.staff <= 1 ? 'hand-chip hand-chip--right' : 'hand-chip hand-chip--left'}>
          {hand}
        </span>
        <span className="note-popover__origin">{origin}</span>
        <button type="button" className="note-popover__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="note-popover__row">
        <button type="button" title="Down a semitone (↓)" onClick={() => onAction('down')}>
          ♭ −1
        </button>
        <button type="button" title="Up a semitone (↑)" onClick={() => onAction('up')}>
          ♯ +1
        </button>
        <button type="button" title="Down an octave (Shift+↓)" onClick={() => onAction('octaveDown')}>
          −8ve
        </button>
        <button type="button" title="Up an octave (Shift+↑)" onClick={() => onAction('octaveUp')}>
          +8ve
        </button>
      </div>
      <div className="note-popover__row">
        <button type="button" title="Give to the other hand (H)" onClick={() => onAction('hand')}>
          {note.staff <= 1 ? 'Move to left hand' : 'Move to right hand'}
        </button>
        <button
          type="button"
          className="note-popover__delete"
          title="Remove this note (Delete)"
          onClick={() => onAction('delete')}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
