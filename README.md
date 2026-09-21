# clefcraft

Reads a digital piano over MIDI and shows what you played — as a note name, as
lit keys on an on-screen keyboard, and as real notation. It runs in the
browser and installs on a phone like an app; see [DEPLOY.md](DEPLOY.md).


<img width="861" height="403" alt="image" src="https://github.com/user-attachments/assets/49664cfb-cc30-4d53-b2bd-5b99ffdcdb95" />


## Three modes:

- **Free play** — play anything; see the note names and a live grand staff.
- **Practice** — open a MusicXML file or a PDF. The keyboard lights the keys
  for the next notes, blue for the right hand and orange for the left, with
  the two after that shown faintly so you can prepare your hand.
- **Training** — generated sight-reading exercises on a ladder of thirteen
  levels. The keyboard stays dark while you read and only shows the answer
  after a wrong key.

## Getting started

<img width="300" height="300" alt="qr code" src="https://github.com/user-attachments/assets/343077cd-dbca-4135-8cf3-1c6dc17c6732" />

open the URL https://unsocialism.github.io/clefcraft/ in **Chrome, Edge or Opera**, plug the piano in over
USB, and allow MIDI access when the browser asks.


## Loading scores

| Format | Notation shown | Next-note guidance |
| --- | --- | --- |
| `.musicxml`, `.xml` | Engraved by OpenSheetMusicDisplay | **Yes** — exact pitches |
| `.mxl` (compressed MusicXML) | Same | **Yes** |
| `.pdf` from notation software | The PDF itself, with what was read marked on it | **Yes** — read from the page, correctable |
| `.pdf` scanned from paper | The PDF itself | No |

Every score you open is **kept on the device** (IndexedDB), with any
corrections you made to it, and listed under *Your scores* for next time.
Nothing is uploaded anywhere. A score is identified by a hash of its
contents, so opening the same file again — even under another name — finds
the existing entry and its corrections.

### Reading notes from a PDF

A PDF exported from Sibelius, MuseScore or similar is not a picture: its
noteheads are font glyphs with exact coordinates, and its staff lines are
drawn paths. So reading one is geometry, not image recognition. The reader
walks the page's drawing operators (`core/pdf/glyphs.ts`), finds the staves
and barlines, and turns each notehead's height on the staff into a pitch,
using the clef and key signature it finds (`core/pdf/pdfNotes.ts`). Sibelius's
Opus font and the standard SMuFL fonts (MuseScore's Leland, Bravura) are
both mapped.

Measured on the two files it was built against: a MuseScore export read
434 of 434 notes and 95 of 95 measures correctly; a Sibelius export gives
747 notes with none off the staff grid.

What it does not read is **rhythm**. The notes are in the right order and
chords are grouped, but durations are unknown — so a PDF works in *wait for
me* mode and not in *play along*. A scanned PDF has no glyphs at all and
gets no guidance.

**Checking and correcting the reading.** *Mark what was read* puts a marker
on every notehead it found, coloured by hand; *Label pitches* adds the pitch
it read. A wrong note is obvious at a glance. *Correct notes* lets you:

- tap a marker to move it a semitone or an octave, switch its hand, or delete it
  (on a keyboard: ↑↓, Shift+↑↓, H, Delete, Esc);
- tap an empty spot on a staff to add a note that was missed;
- undo, or discard every correction.

Corrections are stored as changes to the reading, not as an edited copy, and
are saved as you make them.

## Training

Each exercise is four bars of quarter notes. Notes move mostly by step,
with the occasional small leap, because reading real music is mostly reading
intervals — "up a third from here" — and a random jumble of notes trains the
wrong habit. Every level adds exactly one thing to the one before:

| Level | What it adds |
| --- | --- |
| 1 · Five-finger position | Treble clef, C4 to G4 |
| 2 · Treble staff | Every line and space of the treble staff |
| 3 · Bass staff | Every line and space of the bass staff |
| 4 · Both staves | The melody passes between the hands, at barlines |
| 5 · Ledger lines | Two ledger lines above and below each staff |
| 6 · Sharps and flats | Keys up to two sharps or flats, and accidentals in the bar |
| 7 · Intervals | Two notes at once in one hand — thirds to octaves — in any order |
| 8 · Intervals together | The same, pressed together (the 120ms chord window) |
| 9 · More keys | Keys up to four sharps or flats |
| 10 · Triads | Three-note chords in one hand, root position, pressed together — back to keys up to two sharps or flats |
| 11 · Inversions | Triads in first and second inversion too |
| 12 · Both hands | A note in each hand on every beat, pressed together |
| 13 · Both hands, chords | A triad in the right hand over a bass note, keys up to four sharps or flats |

The note to play is shown in its hand's colour; played notes turn green, or
orange if they took more than one try. The keyboard gives no hint until a
wrong key. From level 8 on, notes that are not pressed together start
over, and the controls bar says so. The chord levels (10–13) have no
accidentals: an altered note would change the chord, which is a harmony
lesson rather than a reading one. At the end you get how many were right
first time, the wrong keys, and the time; any key on the piano then starts
the next exercise. The level you are on is remembered.

Exercises are generated from a seed (`core/training/generator.ts`), which is
what makes them testable: the same seed always gives the same exercise.

## On a phone

The app is installable (a PWA) and works offline once it has been opened
online. Double-tap the music to slide the controls away, leaving only the
sheet and the keyboard — useful with a phone in landscape on the music
stand. Double-tap again, pull down from the top of the sheet, or tap the
small tab at the top of the screen to bring them back. Scrolling up to reread
a line deliberately does not. While the controls are hidden, a PDF scrolls
along to keep the current note on screen. Double-tap is off while correcting
notes, where every tap on the page means "a note goes here".

On a PC the same is under **Hide menus**, next to Settings (double-clicking
the music works too). **Esc**, or the small tab at the top of the screen,
brings the menus back.

## Layout

The page never scrolls. The header and controls stay put, the score or PDF
scrolls in its own region, and the keyboard is pinned across the bottom so
the keys to play are always visible no matter how long the piece is. For
MusicXML the score also scrolls itself to keep the current note in view, and
the keyboard strip scrolls sideways to the keys you need on a narrow screen.

## Practice modes

**Wait for me.** The cursor holds until you play the right notes. Wrong notes
are counted but do not block you; the "Restart the chord on a wrong note"
option makes it strict.

**Chords together.** On by default, with a 120ms window on the slider. A
half-played chord is abandoned once the window closes, putting every key back
on the keyboard — without that timer the partial attempt would sit there
until some later keypress happened to reset it. All
the notes of a chord have to be struck inside the window or the chord does
not count — without this the engine cannot tell a chord from an arpeggio,
and rolling C, E, G one at a time over several seconds would satisfy a
C major triad. A note arriving after the window has closed is treated as the
first note of a fresh attempt, not as a mistake: playing raggedly should mean
"try again", not "wrong". Clicks on the on-screen keyboard bypass the window
entirely, because a mouse can only press one key at a time.

**Play along.** A clock drives the cursor at the tempo in the file (or
whatever you set), and keeps going whether you keep up or not.

Both count mistakes and clean events, and you can jump to any measure.

## Browser support

Web MIDI is the only way for a web page to read a MIDI instrument, and support
is uneven:

| Browser | MIDI input |
| --- | --- |
| Chrome / Edge / Opera, desktop | Yes |
| Chrome, Android | Yes |
| Firefox, desktop | Yes, after granting the site MIDI permission |
| Safari, macOS and iOS | **No** — Web MIDI is not implemented |

Without MIDI the app still runs: the on-screen keyboard is clickable, so the
notation, note names and practice modes work by mouse or touch.

## How it is put together

```
src/
  core/          no React, no DOM — pure logic, unit-tested
    midi/
      types.ts          the MidiInputSource interface and error types
      parse.ts          raw MIDI bytes -> events
      webMidiSource.ts  Web MIDI implementation
      mockSource.ts     in-memory implementation for tests
    music/
      keySignature.ts   the 15 major keys and their accidentals
      pitch.ts          MIDI number -> letter, accidental, octave
      staff.ts          clef assignment and VexFlow-ready note data
      keyboard.ts       piano key geometry, in white-key units
    pdf/
      glyphs.ts         a page's drawing operators -> glyphs, lines, strokes
      staffGeometry.ts  staves, systems and clefs from those lines
      pdfNotes.ts       noteheads -> pitches, measures, hands
      edits.ts          your corrections, as changes to the reading
    score/
      types.ts          Score / ScoreEvent — what practice matches against
      fromSteps.ts      cursor steps -> Score (durations, rests, merging)
      pdfScore.ts       PDF notes -> Score, grouping chords by position
      practiceEngine.ts the practice state machine
      testScores.ts     builders shared by tests and demos
    training/
      generator.ts      the thirteen levels and the exercise generator
    library/
      library.ts        scores and corrections kept on the device
    noteState.ts        held keys + sustain pedal, as a pure reducer
  hooks/
    usePianoInput.ts    owns the MIDI connection
    usePractice.ts      owns a practice session and the tempo clock
    useTraining.ts      a training exercise, on its own practice session
    useImmersive.ts     hiding the controls: double-tap and pull-down
  ui/                   React components; drawing only
    score/osmdAdapter.ts   the only file that knows OSMD's object graph
    pdf/PdfView.tsx        pages, the reading overlay, correcting notes
    training/              the exercise sheet (VexFlow) and its controls
public/
  manifest.webmanifest, sw.js, icons/   what makes it installable and offline
```

The split is the point. `core/` imports nothing from React, the DOM or Vite,
so every musical decision is testable without a browser — and a different
shell can reuse it untouched.

Training runs on its **own** practice session, separate from the Practice
tab's, so a piece you are working on keeps its place while you do a few
exercises in between.

### Details worth knowing

**Note-on with velocity 0 is a note-off.** Most keyboards release keys that
way rather than sending an explicit note-off. Miss it and every note sticks on.

**Presses are timestamped with `performance.now()`, not the device clock.**
Web MIDI timestamps are meant to share that clock but are not reliably
populated across drivers; mixing a device timestamp with the clock used for
on-screen clicks compares two epochs, which shuts the chord window
permanently and stops a real instrument advancing at all. The handling delay
is a few milliseconds — far inside any usable window.

**Clicks bypass the expiry timer as well as the window.** A mouse presses one
key at a time, so exempting it from the window but not from the timer would
let the timer throw away progress the window was never going to reject.

**Practice is driven by note-on events, not by which keys are held.** Playing
legato means the previous chord is often still down when the next is struck,
so the held-key set cannot tell you whether the next chord was actually
played.

**Event index is not cursor position.** Rests occupy a cursor step but are not
playable events, so `ScoreEvent.cursorIndex` carries the real cursor position.
Driving OSMD's cursor by event index would drift off the notation at the first
rest.

**A held-over key that the new chord also needs stays amber.** It has to be
re-struck, so showing it as "already playing" would be a lie. The colour
precedence in `styles.css` encodes this deliberately.

**`releasePointerCapture` must be guarded.** Calling it for a pointer that
holds no capture throws `NotFoundError`, and in `onPointerDown` that throw
lands before the note is ever played — the key silently does nothing. It is
called at all so that touch does not capture the pointer and kill glissando.

**Hidden controls use `inert`, not just CSS.** Once the controls slide
away they must also be out of reach of Tab and screen readers, or a
keyboard user tabs into buttons they cannot see. React 18 does not know the
attribute, so it is set on the element directly.

**The saved-scores database is still called `piano-notes`.** It predates the
rename. The name is invisible to you, but it is what the browser files your
saved scores under: renaming it would make every score and correction
already on a device silently vanish.

**No `overflow: hidden` on the score or PDF container.** They sit in a flex
column; hidden overflow plus flex shrinking clips the document to the height
of its box, and the rest of the score becomes unreachable rather than
scrollable.

**Enharmonic spelling depends on the key.** MIDI note 66 is one pitch, but it
is F♯ in D major and G♭ in E♭ major. `spellNote` picks the letter from the key
signature, preferring a natural over an awkward letter — which is why F major
writes note 71 as B♮ and not C♭.

**pdf.js legacy build, on purpose.** The default build calls very recent JS
APIs; on a Chrome even slightly behind, the second page of a document fails to
render with an unhelpful error. The legacy build ships the polyfills.

## Growing this further

The input layer is behind `MidiInputSource`, so other shells do not need a
rewrite:

- **Desktop (Tauri or Electron).** The Chromium-based webview already supports
  Web MIDI, so `WebMidiInputSource` works as-is. `base: './'` in
  `vite.config.ts` is already set for this.
- **Android, as a store app (Capacitor).** The installable web app already
  covers Android. If a store build is ever wanted, Chrome's WebView supports
  Web MIDI too.

iOS needs real work: there is no Web MIDI in any iOS browser or webview, so it
would need a native CoreMIDI bridge behind the same interface.

## What has and has not been tested

**Verified:** 279 unit tests — among them pitch spelling across all 15 keys
and all 88 notes, MIDI parsing, the sustain pedal, the practice state
machine and its chord window, PDF reading against real Sibelius and
MuseScore exports, corrections, the device library, and the training
generator (ranges, stepwise motion, hand changes, accidentals, intervals).
End-to-end in headless Chromium: all three modes, PDF reading and
correcting, the library across reloads, offline use through the service
worker, playing training exercises through (including a simulated MIDI
piano for the chord timing), and the hide-the-controls gestures at phone
size. The training sheet was checked with the real VexFlow.

**Not verified:** **OpenSheetMusicDisplay** (MusicXML engraving) has only run
against a recording stub, not the real library, and the touch gestures have
been simulated rather than tried on a real phone. Rendering failures are
caught and shown rather than leaving a blank page:

- Staff problems → the error prints under the staff.
- Score-reading problems → a "read with N warnings" panel lists what the
  adapter could not find, with the property paths it did resolve.

## When something does not work

Practice mode has a **"What the app is hearing"** panel in the controls bar. It
shows the notes the app is waiting for, and the last eight keys it received
with what it made of each: counted, not in this chord, already had it, or too
late. Between them those distinguish the three ways this can fail — notes not
arriving at all, arriving at a pitch the score does not expect, or arriving
correctly but spread too wide for the chord window.

## Developing

To run it from the source on your own computer:

```bash
npm install
npm run dev
```

Then open the printed URL in **Chrome, Edge or Opera**. On Windows
PowerShell, use `npm.cmd` in place of `npm`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the unit tests |
| `npm run typecheck` | `tsc --noEmit` |

Requires Node 22.6 or newer — the tests run TypeScript directly through Node's
built-in test runner, with no build step and no test framework dependency.

Pushing to `main` on GitHub runs the tests and the type check and, if both
pass, publishes the app to GitHub Pages (`.github/workflows/deploy.yml`).
[DEPLOY.md](DEPLOY.md) has the full steps.

## Ideas for later

- Rhythm from PDFs, so play-along works for them too
- Chord naming from the sounding notes
- Repeats and da capo handling in the practice cursor
- Exporting and importing your corrections as a backup
