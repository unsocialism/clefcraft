import { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

import { buildScoreFromSteps } from '../../core/score/fromSteps.ts';
import type { Score } from '../../core/score/types.ts';
import { readCursorSteps, type AdapterDiagnostics, type OsmdLike } from './osmdAdapter.ts';

export interface LoadedScore {
  readonly score: Score;
  readonly diagnostics: AdapterDiagnostics;
}

export interface ScoreViewProps {
  /** MusicXML text, or a Blob holding a compressed .mxl. */
  readonly content: string | Blob | null;
  readonly fileName: string | null;
  /** Cursor step to sit on — ScoreEvent.cursorIndex, not ScoreEvent.index. */
  readonly cursorIndex: number;
  readonly showCursor: boolean;
  onLoaded(loaded: LoadedScore): void;
  onError(message: string): void;
}

/**
 * Renders a MusicXML score and keeps OSMD's cursor on the requested step.
 *
 * OSMD is the only source of truth for note data here: the Score model is
 * built by walking OSMD's own cursor, so a step count in this component and
 * an event index in the practice engine can never drift apart. The
 * alternative — parsing the MusicXML separately — would need the two note
 * orderings to agree, which they would not for repeats, voices or grace
 * notes.
 */
export function ScoreView({
  content,
  fileName,
  cursorIndex,
  showCursor,
  onLoaded,
  onError,
}: ScoreViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const cursorAtRef = useRef(0);
  const [loading, setLoading] = useState(false);

  // Load and render whenever the file changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || content === null) return;

    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        osmdRef.current?.clear();
        const osmd = new OpenSheetMusicDisplay(host, {
          autoResize: true,
          backend: 'svg',
          drawTitle: true,
          drawPartNames: false,
          followCursor: true,
        });
        osmdRef.current = osmd;

        // OSMD's typings accept string | Document | Blob.
        await osmd.load(content as string | Document);
        if (cancelled) return;
        osmd.render();

        // Walking the cursor redraws it at every step; hiding it first keeps
        // a long score from repainting hundreds of times during the read.
        osmd.cursor.hide();
        const { steps, title, tempoBpm, diagnostics } = readCursorSteps(
          osmd as unknown as OsmdLike,
        );
        const score = buildScoreFromSteps(steps, {
          title: title ?? fileName ?? 'Untitled score',
          tempoBpm,
          source: 'musicxml',
        });

        // readCursorSteps leaves the cursor at the end; put it back.
        osmd.cursor.reset();
        cursorAtRef.current = 0;
        osmd.cursor.show();

        if (!cancelled) onLoaded({ score, diagnostics });
      } catch (cause) {
        if (!cancelled) {
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // onLoaded/onError are stable callbacks from the parent; re-running on
    // their identity would reload the score on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, fileName]);

  // Keep the drawn cursor on the step the practice engine is on.
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd?.cursor) return;
    try {
      if (!showCursor) {
        osmd.cursor.hide();
        return;
      }
      osmd.cursor.show();

      // Stepping forward is cheap; going back means resetting and replaying,
      // which is why the cursor position is tracked rather than recomputed.
      if (cursorIndex < cursorAtRef.current) {
        osmd.cursor.reset();
        cursorAtRef.current = 0;
      }
      while (cursorAtRef.current < cursorIndex) {
        osmd.cursor.next();
        cursorAtRef.current++;
      }
      // next() advances the iterator; update() is what moves the drawn
      // cursor to it. Calling it once at the end is enough and avoids a
      // repaint per step when seeking backwards across a long piece.
      osmd.cursor.update();

      // Keep the current note in view. OSMD's own followCursor scrolls the
      // nearest scrollable ancestor, which here is the app shell's middle
      // region, but it has not been reliable across versions — so the cursor
      // element is scrolled explicitly as well. Both are no-ops if the note
      // is already visible.
      const element = (osmd.cursor as unknown as { cursorElement?: HTMLElement }).cursorElement;
      element?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex, showCursor]);

  useEffect(
    () => () => {
      try {
        osmdRef.current?.clear();
      } catch {
        /* nothing useful to do while unmounting */
      }
    },
    [],
  );

  return (
    <div className="score-view">
      {loading && <p className="score-view__status">Rendering score…</p>}
      <div ref={hostRef} className="score-view__host" />
    </div>
  );
}
