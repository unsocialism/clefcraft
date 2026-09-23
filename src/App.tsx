import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isWebMidiSupported } from './core/midi/webMidiSource.ts';
import { fullVersion, shortVersion } from './version.ts';
import type { AccidentalPreference } from './core/music/pitch.ts';
import {
  NO_EDITS,
  addNote,
  applyEdits,
  editCount,
  idOfAdded,
  noteAtPoint,
  removeNote,
  shiftNote,
  switchHand,
  type NoteEdits,
} from './core/pdf/edits.ts';
import { openLibrary, type Library, type ScoreEntry } from './core/library/library.ts';
import { MidiFileError, parseMidiFile } from './core/midi/midiFile.ts';
import { scoreFromMidi, type MidiScore } from './core/score/midiScore.ts';
import { scoreFromPdfNotes } from './core/score/pdfScore.ts';
import { toMidiFile, toMusicXml } from './core/score/exportScore.ts';
import { EMPTY_SCORE } from './core/score/types.ts';
import type { PdfReadResult } from './core/pdf/pdfNotes.ts';
import { usePianoInput } from './hooks/usePianoInput.ts';
import { useImmersive } from './hooks/useImmersive.ts';
import { DEFAULT_METER, usePractice } from './hooks/usePractice.ts';
import { useTraining } from './hooks/useTraining.ts';
import { GrandStaff } from './ui/GrandStaff.tsx';
import { NoteReadout } from './ui/NoteReadout.tsx';
import { PianoKeyboard, type KeyGuide } from './ui/PianoKeyboard.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { PdfView, type EditAction } from './ui/pdf/PdfView.tsx';
import { CountIn } from './ui/practice/BeatPulse.tsx';
import { PracticeControls } from './ui/practice/PracticeControls.tsx';
import { MidiMonitor } from './ui/practice/MidiMonitor.tsx';
import { ScoreLibrary } from './ui/practice/ScoreLibrary.tsx';
import { ScoreLoader, type LoadedFile } from './ui/practice/ScoreLoader.tsx';
import { MidiSheet } from './ui/score/MidiSheet.tsx';
import { ScoreView, type LoadedScore } from './ui/score/ScoreView.tsx';
import { TrainingControls, TrainingSummary } from './ui/training/TrainingControls.tsx';
import { TrainingSheet } from './ui/training/TrainingSheet.tsx';

type AppMode = 'free' | 'practice' | 'training';

const MODES: readonly { id: AppMode; label: string }[] = [
  { id: 'free', label: 'Free play' },
  { id: 'practice', label: 'Practice' },
  { id: 'training', label: 'Training' },
];

/**
 * Fixed application shell.
 *
 * The page itself never scrolls: the header and controls stay put, the score
 * or PDF scrolls inside the middle region, and the keyboard is pinned across
 * the bottom. That is the whole point of the keyboard — it has to be visible
 * while you are reading the music above it, and a score of any length would
 * otherwise push it off the screen entirely.
 */
export function App() {
  const [appMode, setAppMode] = useState<AppMode>('free');
  const [fifths, setFifths] = useState(0);
  const [accidentals, setAccidentals] = useState<AccidentalPreference>('auto');
  const [showLabels, setShowLabels] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [file, setFile] = useState<LoadedFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<LoadedScore['diagnostics'] | null>(null);
  // Fit the page to the screen on a phone rather than making you scroll
  // sideways through every line; cap it on a desktop, where full width
  // would make a page taller than the window.
  const [pdfZoom, setPdfZoom] = useState(() =>
    Math.round(Math.min(900, Math.max(300, (globalThis.innerWidth ?? 900) - 40)) / 10) * 10,
  );
  const [showOverlay, setShowOverlay] = useState(true);
  const [showPitches, setShowPitches] = useState(false);
  const [pdfRead, setPdfRead] = useState<PdfReadResult | null>(null);
  // A MIDI file, read and engraved. Unlike a PDF it carries real rhythm,
  // so play-along works from it.
  const [midiScore, setMidiScore] = useState<MidiScore | null>(null);
  // Where the hands part when the file itself does not say. Changing it
  // re-reads the file, which is cheap and keeps everything in step.
  const [midiSplit, setMidiSplit] = useState(60);
  const [midiData, setMidiData] = useState<ArrayBuffer | null>(null);

  // Corrections to the PDF reading, with an undo history. Kept as changes
  // against the reading rather than an edited copy — see core/pdf/edits.ts.
  const [edits, setEdits] = useState<NoteEdits>(NO_EDITS);
  const [editHistory, setEditHistory] = useState<readonly NoteEdits[]>([]);
  const [editing, setEditing] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // Set when a score rebuild comes from a correction rather than a new file,
  // so your place in the piece survives fixing a note.
  const keepPositionRef = useRef(false);

  const practice = usePractice();
  const { handleMidi, handleRawMessage, setScore, setMeter } = practice;

  // The meter the count-in counts and the pulse beats in. A MIDI file states
  // it; nothing else we read does, so four in a bar is the assumption.
  useEffect(() => {
    const first = midiScore?.measures[0];
    setMeter(first ? { beats: first.beats, beatType: first.beatType } : DEFAULT_METER);
  }, [midiScore, setMeter]);

  /** Play along is running: the clock is moving and the line sweeps. */
  const playingAlong = practice.running && practice.mode === 'tempo';

  // Training runs its own practice engine, so a piece you are working on
  // keeps its place while you do a few reading exercises in between.
  const training = useTraining();
  const trainingMidi = training.handleMidi;
  const trainingRaw = training.practice.handleRawMessage;

  // Only feed a practice engine while its tab is open, so free play cannot
  // silently advance a loaded score — and each tab's keys go to its own.
  const inPractice = appMode === 'practice';
  const inTraining = appMode === 'training';
  const piano = usePianoInput(
    useMemo(
      () => ({
        onEvent: inPractice ? handleMidi : inTraining ? trainingMidi : undefined,
        onRawMessage: inPractice ? handleRawMessage : inTraining ? trainingRaw : undefined,
      }),
      [inPractice, inTraining, handleMidi, handleRawMessage, trainingMidi, trainingRaw],
    ),
  );

  const mainRef = useRef<HTMLElement | null>(null);
  // Not while correcting notes: there, every tap on the page means "a note
  // goes here", and two quick ones would be misread as a request to hide.
  const immersive = useImmersive(mainRef, { allowDoubleTap: !editing });
  // A mouse or trackpad gets PC wording in the hint; a finger gets touch.
  const finePointer = useMemo(
    () => globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false,
    [],
  );
  // Hidden controls must also be out of reach of Tab and screen readers.
  // (`inert` is set directly: React 18 does not know the attribute.)
  const topSlotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    topSlotRef.current?.toggleAttribute('inert', immersive.on);
  }, [immersive.on]);

  const { connect, status } = piano;

  useEffect(() => {
    if (status === 'idle' && isWebMidiSupported()) connect();
  }, [status, connect]);

  const handleNoteDown = useCallback(
    (midi: number) => piano.send({ type: 'noteon', note: midi, velocity: 80, channel: 0, time: 0 }),
    [piano],
  );
  const handleNoteUp = useCallback(
    (midi: number) => piano.send({ type: 'noteoff', note: midi, velocity: 0, channel: 0, time: 0 }),
    [piano],
  );

  // ---- scores kept on this device ----
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [entries, setEntries] = useState<readonly ScoreEntry[] | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    openLibrary()
      .then(async (opened) => {
        if (cancelled) return;
        setLibrary(opened);
        setEntries(await opened.list());
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLibraryError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshEntries = useCallback(async () => {
    if (library) setEntries(await library.list());
  }, [library]);

  /**
   * Open a score, keeping it in the library and bringing back any
   * corrections made to it before.
   *
   * The corrections are fetched *before* any state is set, and then
   * everything is set together. Setting the file first would render it
   * with no corrections, and the save effect below would write that empty
   * set over the stored one before the real one arrived.
   */
  const openFile = useCallback(
    async (loaded: LoadedFile) => {
      let id: string | null = null;
      let saved: NoteEdits | null = null;
      if (library) {
        try {
          const data =
            loaded.content instanceof Blob ? loaded.content : new Blob([loaded.content]);
          const entry = await library.save({ name: loaded.name, kind: loaded.kind, data });
          id = entry.id;
          if (loaded.kind === 'pdf') saved = await library.loadEdits(entry.id);
          void refreshEntries();
        } catch {
          // Keeping the file is a convenience; failing to must not stop it
          // opening. Most likely cause: the device is out of storage.
        }
      }

      setLoadError(null);
      setDiagnostics(null);
      setMidiScore(null);
      setFile(loaded);
      setFileId(id);
      if (loaded.kind === 'midi') {
        try {
          const data = loaded.content as ArrayBuffer;
          const read = scoreFromMidi(parseMidiFile(data), {
            title: loaded.name.replace(/\.[^.]+$/, ''),
            splitPoint: midiSplit,
          });
          setMidiData(data);
          setMidiScore(read);
          setScore(read.score);
        } catch (cause) {
          setScore(EMPTY_SCORE);
          setLoadError(
            cause instanceof MidiFileError
              ? cause.message
              : `${loaded.name} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
      if (loaded.kind === 'pdf') {
        // Cleared rather than left pointing at the previous score; the
        // reader fills it back in once the pages have been parsed.
        setScore(EMPTY_SCORE);
        setPdfRead(null);
        setEdits(saved ?? NO_EDITS);
        setEditHistory([]);
        setSelectedNoteId(null);
        setEditing(false);
      }
      setAppMode('practice');
    },
    [library, refreshEntries, setScore, midiSplit],
  );

  /** Re-read the open MIDI file with the hands split somewhere else. */
  const changeMidiSplit = useCallback(
    (splitPoint: number) => {
      setMidiSplit(splitPoint);
      if (!midiData || file?.kind !== 'midi') return;
      try {
        const read = scoreFromMidi(parseMidiFile(midiData), {
          title: file.name.replace(/\.[^.]+$/, ''),
          splitPoint,
        });
        setMidiScore(read);
        setScore(read.score, { keepPosition: true });
      } catch {
        // The file already read once; a different split cannot break it.
      }
    },
    [midiData, file, setScore],
  );

  const handleFile = useCallback((loaded: LoadedFile) => void openFile(loaded), [openFile]);

  const openFromLibrary = useCallback(
    async (entry: ScoreEntry) => {
      if (!library) return;
      const stored = await library.load(entry.id);
      if (!stored) {
        setLoadError(`"${entry.name}" is no longer on this device.`);
        void refreshEntries();
        return;
      }
      // Rebuild exactly what the file picker would have produced: a PDF as
      // bytes, a compressed .mxl as a Blob for OSMD to unzip, plain MusicXML
      // as text.
      const content =
        entry.kind === 'pdf' || entry.kind === 'midi'
          ? await stored.data.arrayBuffer()
          : entry.name.toLowerCase().endsWith('.mxl')
            ? stored.data
            : await stored.data.text();
      await openFile({ kind: entry.kind, name: entry.name, content });
    },
    [library, openFile, refreshEntries],
  );

  const closeFile = useCallback(() => {
    setFile(null);
    setFileId(null);
    setScore(EMPTY_SCORE);
    setPdfRead(null);
    setMidiScore(null);
    setMidiData(null);
    setDiagnostics(null);
    setEditing(false);
    setSelectedNoteId(null);
    setEdits(NO_EDITS);
    setEditHistory([]);
    void refreshEntries();
  }, [refreshEntries, setScore]);

  const removeEntry = useCallback(
    async (entry: ScoreEntry) => {
      if (!library) return;
      await library.remove(entry.id);
      if (entry.id === fileId) closeFile();
      await refreshEntries();
    },
    [library, fileId, closeFile, refreshEntries],
  );

  const handlePdfRead = useCallback((result: PdfReadResult) => {
    keepPositionRef.current = false;
    setPdfRead(result);
  }, []);

  // The notes as they stand after your corrections, and the practice score
  // built from them. Everything downstream — the overlay, the keyboard
  // guides, the practice engine — sees the corrected version.
  const shownNotes = useMemo(
    () => (pdfRead ? applyEdits(pdfRead.notes, edits, pdfRead.pages) : []),
    [pdfRead, edits],
  );
  const pdfScore = useMemo(() => {
    if (!pdfRead) return null;
    const spacing = pdfRead.pages[0]?.staves[0]?.spacing;
    return scoreFromPdfNotes(shownNotes, {
      title: file?.name ?? '',
      ...(spacing ? { spacing } : {}),
    });
    // The title only matters when a new file arrives, which also changes
    // pdfRead; leaving `file` out keeps a rename from rebuilding the score.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfRead, shownNotes]);
  const pdfAnchors = pdfScore?.anchors ?? [];

  useEffect(() => {
    if (!pdfScore) return;
    setScore(pdfScore.score, { keepPosition: keepPositionRef.current });
  }, [pdfScore, setScore]);

  // Corrections are saved as you make them. Only for PDFs: a MusicXML file
  // states its notes exactly and has nothing to correct.
  useEffect(() => {
    if (!library || !fileId || file?.kind !== 'pdf') return;
    library.saveEdits(fileId, edits).catch(() => undefined);
  }, [library, fileId, file?.kind, edits]);

  // State updaters must stay pure: React runs them twice in development to
  // prove it, so an updater that pushed onto the undo history would push
  // every edit twice. Read the current value from the closure instead.
  const commitEdits = useCallback(
    (next: NoteEdits) => {
      if (next === edits) return;
      keepPositionRef.current = true;
      setEditHistory((history) => [...history.slice(-99), edits]);
      setEdits(next);
    },
    [edits],
  );

  const undoEdit = useCallback(() => {
    const previous = editHistory[editHistory.length - 1];
    if (!previous) return;
    keepPositionRef.current = true;
    setEditHistory(editHistory.slice(0, -1));
    setEdits(previous);
    setSelectedNoteId(null);
  }, [editHistory]);

  const handleAddAt = useCallback(
    (page: number, x: number, y: number) => {
      const layout = pdfRead?.pages.find((l) => l.page === page);
      if (!layout) return;
      const note = noteAtPoint(layout, x, y);
      if (!note) return;
      commitEdits(addNote(edits, note));
      setSelectedNoteId(idOfAdded(note));
    },
    [pdfRead, edits, commitEdits],
  );

  const handleEditAction = useCallback(
    (id: string, action: EditAction) => {
      const note = shownNotes.find((n) => n.id === id);
      if (!note) return;
      switch (action) {
        case 'up':
          commitEdits(shiftNote(edits, note, 1));
          break;
        case 'down':
          commitEdits(shiftNote(edits, note, -1));
          break;
        case 'octaveUp':
          commitEdits(shiftNote(edits, note, 12));
          break;
        case 'octaveDown':
          commitEdits(shiftNote(edits, note, -12));
          break;
        case 'hand':
          commitEdits(switchHand(edits, note));
          break;
        case 'delete':
          commitEdits(removeNote(edits, note));
          setSelectedNoteId(null);
          break;
      }
    },
    [shownNotes, edits, commitEdits],
  );

  /**
   * Save the notes as they now stand — corrections included — as a file
   * something else can read. Rhythm is not read from a PDF, so what goes
   * out is pitches, chords and barlines, one quarter note per event.
   */
  const exportPdfNotes = useCallback(
    (format: 'midi' | 'musicxml') => {
      if (!pdfScore || pdfScore.clusters.length === 0) return;
      const base = (file?.name ?? 'score').replace(/\.[^.]+$/, '');
      // Cosmetic only — every note carries its own pitch — so the key of
      // the first staff read is good enough.
      const fifths = pdfRead?.pages[0]?.staffInfo[0]?.keyFifths ?? 0;
      const options = { title: base, fifths };
      const [data, type, extension] =
        format === 'midi'
          ? ([toMidiFile(pdfScore.clusters, options), 'audio/midi', 'mid'] as const)
          : ([toMusicXml(pdfScore.clusters, options), 'application/vnd.recordare.musicxml+xml', 'musicxml'] as const);
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${base}.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      // Revoked on a later tick: Safari has not finished with the URL when
      // click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    [pdfScore, file?.name, pdfRead],
  );

  const handleScoreLoaded = useCallback(
    (loaded: LoadedScore) => {
      setScore(loaded.score);
      setDiagnostics(loaded.diagnostics);
    },
    [setScore],
  );

  // Staff 1 is the right hand and staff 2 the left: the convention of every
  // piano score, and the only hand information a score carries.
  const guides: readonly KeyGuide[] = useMemo(() => {
    if (inTraining) {
      // Training is for reading, so the keyboard stays quiet — until a wrong
      // key, when it shows where the note is. Showing it from the start
      // would turn a reading exercise into following lit-up keys.
      const now = training.practice.ahead[0];
      if (!now || training.practice.state.wrongHere === 0) return [];
      return now.remaining.map((midi) => ({
        midi,
        distance: 0,
        hand: (now.event.notes.some((n) => n.midi === midi && n.staff === 2)
          ? 'left'
          : 'right') as KeyGuide['hand'],
      }));
    }
    if (!inPractice) return [];
    return practice.ahead.flatMap((step) =>
      step.remaining.map((midi) => {
        const staves = new Set(
          step.event.notes.filter((n) => n.midi === midi).map((n) => (n.staff <= 1 ? 1 : 2)),
        );
        const hand: KeyGuide['hand'] =
          staves.size > 1 ? 'both' : staves.has(2) ? 'left' : 'right';
        return { midi, distance: step.distance, hand };
      }),
    );
  }, [inPractice, practice.ahead, inTraining, training.practice.ahead, training.practice.state.wrongHere]);

  const cursorIndex = practice.score.events[practice.state.index]?.cursorIndex ?? 0;

  // Where on the page the notes now due were drawn.
  const pdfHighlight = useMemo(() => {
    if (!inPractice || practice.state.finished) return [];
    const anchor = pdfAnchors[practice.state.index];
    return anchor ? [anchor] : [];
  }, [inPractice, pdfAnchors, practice.state.index, practice.state.finished]);

  // Everything the current event still wants, for the monitor.
  const expectedNow = practice.ahead[0]?.remaining ?? [];

  return (
    <div className={immersive.on ? 'app app--immersive' : 'app'}>
      <div className="app__top-slot" ref={topSlotRef}>
        <div className="app__top">
          <header className="app__header">
            <div className="app__title">
              <h1>clefcraft</h1>
            <span className="app__version" title={fullVersion()}>
              {shortVersion()}
            </span>
              <span className={`status status--${piano.status}`}>
                <span className="status__dot" aria-hidden="true" />
                {piano.status === 'ready' ? 'Listening' : 'Not connected'}
              </span>
            </div>
            <div className="app__header-actions">
              <nav className="segmented" role="tablist" aria-label="Mode">
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    aria-selected={appMode === mode.id}
                    className={
                      appMode === mode.id
                        ? 'segmented__option segmented__option--on'
                        : 'segmented__option'
                    }
                    onClick={() => setAppMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </nav>
              <button
                type="button"
                className="button"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((open) => !open)}
              >
                {showSettings ? 'Hide settings' : 'Settings'}
              </button>
              <button
                type="button"
                className="button"
                title="Only the music and the keyboard. Esc or the tab at the top brings the menus back."
                onClick={() => immersive.set(true)}
              >
                Hide menus
              </button>
            </div>
          </header>

          {showSettings && (
            <Toolbar
              status={piano.status}
              errorMessage={piano.errorMessage}
              ports={piano.ports}
              selectedPortId={piano.selectedPortId}
              fifths={fifths}
              accidentals={accidentals}
              showLabels={showLabels}
              onConnect={piano.connect}
              onSelectPort={piano.selectPort}
              onFifthsChange={setFifths}
              onAccidentalsChange={setAccidentals}
              onShowLabelsChange={setShowLabels}
              onPanic={piano.panic}
            />
          )}

          {piano.status === 'unsupported' && (
            <p className="app__banner">
              This browser has no Web MIDI support. Chrome, Edge or Opera will work — on Android too.
              Safari and Firefox on iOS cannot read MIDI devices at all. You can still click the keys
              below.
            </p>
          )}

          {appMode === 'training' && <TrainingControls training={training} />}

          {appMode === 'free' && (
            <NoteReadout notes={piano.notes} fifths={fifths} accidentals={accidentals} />
          )}

          {appMode === 'practice' && (
            <>
              <div className="loader-row">
                {file && (
                  <button type="button" className="button" onClick={closeFile}>
                    ← Your scores
                  </button>
                )}
                <ScoreLoader
                  onLoad={handleFile}
                  onError={setLoadError}
                  currentName={file?.name ?? null}
                />
              </div>

              {practice.score.events.length > 0 && (
                <PracticeControls
                  score={practice.score}
                  state={practice.state}
                  mode={practice.mode}
                  requireClean={practice.requireClean}
                  chordWindowMs={practice.chordWindowMs}
                  tempoBpm={practice.tempoBpm}
                  running={practice.running}
                  progress={practice.progress}
                  meter={practice.meter}
                  clock={practice.clock}
                  onModeChange={practice.setMode}
                  onRequireCleanChange={practice.setRequireClean}
                  onChordWindowChange={practice.setChordWindowMs}
                  onTempoChange={practice.setTempoBpm}
                  onStart={practice.start}
                  onPause={practice.pause}
                  onRestart={practice.restart}
                  onSeekMeasure={practice.seekMeasure}
                />
              )}

              {/* A diagnostic you use *while* playing, so it belongs in the
                  fixed bar. Below the score it would sit past the end of a
                  long piece — reachable only by scrolling away from the music. */}
              {practice.score.events.length > 0 && (
                <MidiMonitor
                  recent={practice.state.recent}
                  rawMessages={practice.rawMessages}
                  ignoreDuplicatesMs={practice.ignoreDuplicatesMs}
                  onIgnoreDuplicatesChange={practice.setIgnoreDuplicatesMs}
                  ports={piano.ports}
                  wiring={piano.getWiring()}
                  expected={expectedNow}
                  fifths={fifths}
                  accidentals={accidentals}
                />
              )}

              {file?.kind === 'midi' && midiScore && (
                <div className="toolbar toolbar--compact">
                  <span className="toolbar__inline-note">
                    {midiScore.score.events.length} note
                    {midiScore.score.events.length === 1 ? '' : 's'} over {midiScore.measures.length}{' '}
                    bar{midiScore.measures.length === 1 ? '' : 's'}
                    {midiScore.score.tempoBpm ? ` · ${midiScore.score.tempoBpm} bpm in the file` : ''}
                    {midiScore.handsFrom === 'split'
                      ? ' · hands split by pitch'
                      : ` · hands from the file's ${midiScore.handsFrom}`}
                    . Timing is rounded to the nearest sixteenth, and each hand is written as one
                    line of rhythm.
                  </span>
                  {midiScore.handsFrom === 'split' && (
                    <label className="toolbar__field">
                      <span>Left hand below</span>
                      <select
                        value={midiSplit}
                        onChange={(event) => changeMidiSplit(Number(event.target.value))}
                      >
                        {[36, 48, 60, 72].map((midi) => (
                          <option key={midi} value={midi}>
                            C{midi / 12 - 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {file?.kind === 'pdf' && (
                <div className="toolbar toolbar--compact">
                  <label className="toolbar__field">
                    <span>Page width · {pdfZoom}px</span>
                    <input
                      type="range"
                      min={300}
                      max={1800}
                      step={50}
                      value={pdfZoom}
                      onChange={(event) => setPdfZoom(Number(event.target.value))}
                    />
                  </label>
                  <label className="toolbar__checkbox">
                    <input
                      type="checkbox"
                      checked={showOverlay}
                      onChange={(event) => setShowOverlay(event.target.checked)}
                    />
                    <span>Mark what was read</span>
                  </label>
                  <label className="toolbar__checkbox">
                    <input
                      type="checkbox"
                      checked={showPitches}
                      onChange={(event) => setShowPitches(event.target.checked)}
                    />
                    <span>Label pitches</span>
                  </label>
                  {pdfRead && (
                    <>
                      <button
                        type="button"
                        className={editing ? 'button button--primary' : 'button'}
                        aria-pressed={editing}
                        onClick={() => {
                          setEditing((on) => !on);
                          setSelectedNoteId(null);
                        }}
                      >
                        {editing ? 'Done correcting' : 'Correct notes'}
                      </button>
                      {editing && (
                        <>
                          <button
                            type="button"
                            className="button"
                            disabled={editHistory.length === 0}
                            onClick={undoEdit}
                          >
                            Undo
                          </button>
                          <button
                            type="button"
                            className="button"
                            disabled={editCount(edits) === 0}
                            onClick={() => {
                              commitEdits(NO_EDITS);
                              setSelectedNoteId(null);
                            }}
                          >
                            Discard all corrections ({editCount(edits)})
                          </button>
                        </>
                      )}
                      <button
                      type="button"
                      className="button"
                      onClick={() => exportPdfNotes('midi')}
                      title="The notes as read, corrections included, as a MIDI file"
                    >
                      Save MIDI
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => exportPdfNotes('musicxml')}
                      title="The notes as read, corrections included, as a MusicXML file for a notation editor"
                    >
                      Save MusicXML
                    </button>
                    <span className="toolbar__inline-note">
                        {editing
                          ? 'Tap a marker to fix it, or tap a staff where a note was missed to add it. On a keyboard: ↑↓ semitone, Shift+↑↓ octave, H hand, Delete, Esc.'
                          : `${shownNotes.length} notes over ${pdfRead.diagnostics.measures} measures · ${
                              pdfRead.diagnostics.fontProfile
                            } font${
                              editCount(edits) ? ` · ${editCount(edits)} corrected` : ''
                            }. Rhythm is not read, so play-along timing is not available for a PDF.`}
                      </span>
                    </>
                  )}
                </div>
              )}

              {loadError && <p className="app__banner app__banner--error">{loadError}</p>}
            </>
          )}
        </div>
      </div>

      {immersive.on && (
        <button
          type="button"
          className="app__reveal"
          aria-label="Show the menus"
          title="Show the menus (Esc)"
          onClick={() => immersive.set(false)}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      )}
      {immersive.hint && (
        <p className="app__hint" role="status">
          {finePointer
            ? 'Press Esc, double-click the music, or use the tab at the top to bring the menus back'
            : 'Double-tap or pull down to bring the menus back'}
        </p>
      )}

      <main className="app__main" ref={mainRef}>
        {appMode === 'free' ? (
          <GrandStaff notes={piano.notes} fifths={fifths} accidentals={accidentals} />
        ) : appMode === 'training' ? (
          <>
            <TrainingSheet
              exercise={training.exercise}
              currentIndex={
                training.result ? training.exercise.events : training.practice.state.index
              }
              wrongNow={training.practice.state.wrongHere > 0}
              missed={training.missed}
              follow
            />
            {training.result && (
              <TrainingSummary
                result={training.result}
                level={training.level}
                onNext={training.next}
                onLevel={training.setLevel}
              />
            )}
          </>
        ) : (
          <>
            {file?.kind === 'midi' && midiScore && (
              <MidiSheet
                midiScore={midiScore}
                currentEvent={practice.state.finished ? null : practice.state.index}
                follow
                clock={practice.clock}
                playing={playingAlong}
              />
            )}

            {file?.kind === 'musicxml' && (
              <ScoreView
                content={file.content as string | Blob}
                fileName={file.name}
                cursorIndex={cursorIndex}
                showCursor
                onLoaded={handleScoreLoaded}
                onError={setLoadError}
              />
            )}

            {file?.kind === 'pdf' && (
              <PdfView
                data={file.content as ArrayBuffer}
                fileName={file.name}
                zoom={pdfZoom}
                showOverlay={showOverlay}
                showPitches={showPitches}
                highlight={pdfHighlight}
                onRead={handlePdfRead}
                onError={setLoadError}
                notes={shownNotes}
                editing={editing}
                selectedId={selectedNoteId}
                onSelect={setSelectedNoteId}
                onAddAt={handleAddAt}
                onEditAction={handleEditAction}
                follow={immersive.on}
              />
            )}

            {!file && (
              <ScoreLibrary
                entries={entries}
                error={libraryError}
                onOpen={(entry) => void openFromLibrary(entry)}
                onRemove={(entry) => void removeEntry(entry)}
              />
            )}

            {pdfRead && pdfRead.diagnostics.warnings.length > 0 && (
              <details className="diagnostics" open>
                <summary>
                  PDF read with {pdfRead.diagnostics.warnings.length} warning
                  {pdfRead.diagnostics.warnings.length === 1 ? '' : 's'}
                </summary>
                <ul>
                  {pdfRead.diagnostics.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <p className="diagnostics__meta">
                  {pdfRead.diagnostics.staves} staves · {pdfRead.diagnostics.systems} systems ·{' '}
                  {pdfRead.diagnostics.noteheads} noteheads · {pdfRead.diagnostics.measures}{' '}
                  measures
                </p>
              </details>
            )}

            {diagnostics && diagnostics.warnings.length > 0 && (
              <details className="diagnostics">
                <summary>
                  Score read with {diagnostics.warnings.length} warning
                  {diagnostics.warnings.length === 1 ? '' : 's'}
                </summary>
                <ul>
                  {diagnostics.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <p className="diagnostics__meta">
                  {diagnostics.steps} cursor steps · {diagnostics.notesSeen} notes ·{' '}
                  {diagnostics.rests} rests · {practice.score.events.length} playable events
                </p>
              </details>
            )}
          </>
        )}
      </main>

      <div className="app__bottom">
        <PianoKeyboard
          active={piano.notes}
          guides={guides}
          fifths={fifths}
          accidentals={accidentals}
          showLabels={showLabels}
          guided={(inPractice && practice.score.events.length > 0) || inTraining}
          onNoteDown={handleNoteDown}
          onNoteUp={handleNoteUp}
        />
        {piano.noteState.pedal && <span className="badge badge--pedal">Sustain pedal down</span>}
      </div>

      {/* Over everything, because the controls it belongs to can be hidden. */}
      {inPractice && (
        <CountIn clock={practice.clock} playing={playingAlong} meter={practice.meter} />
      )}
    </div>
  );
}
