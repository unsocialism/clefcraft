# clefcraft

Reads a digital piano over MIDI and shows what you played — as a note name, as
lit keys on an on-screen keyboard, and as real notation on a grand staff.

Two modes:

- **Free play** — play anything; see the note names and a live grand staff.
- **Practice** — load a score, and the keyboard lights the keys for the next
  note, with the following two shown faintly so you can prepare your hand.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed URL in **Chrome, Edge or Opera**, plug the piano in over
USB, and allow MIDI access when the browser asks.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the unit tests |
| `npm run typecheck` | `tsc --noEmit` |

Requires Node 22.6 or newer — the tests run TypeScript directly through Node's
built-in test runner, with no build step and no test framework dependency.

To put this under version control:

```bash
git init && git add . && git commit -m "Initial commit"
```

## Loading scores

| Format | Notation shown | Next-note guidance |
| --- | --- | --- |
| `.musicxml`, `.xml` | Engraved by OpenSheetMusicDisplay | **Yes** — exact pitches |
| `.mxl` (compressed MusicXML) | Same | **Yes** |
| `.pdf` | The PDF itself | No — see below |

**Why MusicXML and not PDF for guidance.** A PDF is a picture of music; it
does not say which pitches are on the page. Reading them back means optical
music recognition, and the main open-source engine (Audiveris) puts itself at
80–90% on clean printed scores, 60–75% on anything with multiple staves, and
states that manual correction is expected. For a practice aid that is worse
than useless: a 15% error rate means being told to press wrong keys, with no
way to know which ones. MusicXML carries the pitches exactly, so the guidance
is either right or absent — never confidently wrong.

MuseScore.com has a large free MusicXML library, and MuseScore (the desktop
app) exports MusicXML from anything you already own.

PDFs are displayed for reading, at an adjustable page width. There is no
guidance on that path yet — the app says so on screen rather than leaving you
to wonder.

**Planned, and measured on a real file.** PDFs exported from notation
software are not images — their noteheads are embedded font glyphs with exact
coordinates. On a Sibelius export tested here: 857 noteheads across two pages,
and within a staff their vertical positions land on a 2.30pt lattice with a
mean error of 0.021 steps. Pitch is arithmetic, not recognition.

What remains is anchoring that lattice to real pitch (clef and staff lines,
both present in the file), rhythm beyond notehead shape, note ordering across
voices and systems, and a glyph table per music font — this maps Sibelius's
Opus; MuseScore's Leland/Bravura and Finale's Maestro each need their own.
The expected failure mode is notes in the wrong order, not wrong notes.

## Layout

The page never scrolls. The header and controls stay put, the score or PDF
scrolls in its own region, and the keyboard is pinned across the bottom so
the keys to play are always visible no matter how long the piece is. For
MusicXML the score also scrolls itself to keep the current note in view.

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
    score/
      types.ts          Score / ScoreEvent — what practice matches against
      fromSteps.ts      cursor steps -> Score (durations, rests, merging)
      practiceEngine.ts the practice state machine
      testScores.ts     builders shared by tests and demos
    noteState.ts        held keys + sustain pedal, as a pure reducer
  hooks/
    usePianoInput.ts    owns the MIDI connection
    usePractice.ts      owns the practice session and the tempo clock
  ui/                   React components; drawing only
    score/osmdAdapter.ts  the only file that knows OSMD's object graph
```

The split is the point. `core/` imports nothing from React, the DOM or Vite,
so every musical decision is testable without a browser — and a different
shell can reuse it untouched.

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

## Growing this into an app

The input layer is behind `MidiInputSource` precisely so the two targets you
have in mind do not need a rewrite:

- **Desktop (Tauri or Electron).** The Chromium-based webview already supports
  Web MIDI, so `WebMidiInputSource` works as-is. `base: './'` in
  `vite.config.ts` is already set for this.
- **Android (Capacitor).** Chrome's WebView supports Web MIDI on Android. If a
  device proves awkward, write a `CapacitorMidiInputSource` against the same
  interface and pass it to `usePianoInput({ makeSource: () => new … })`.
  Nothing else changes.

iOS needs real work: there is no Web MIDI in any iOS browser or webview, so it
would need a native CoreMIDI bridge behind the same interface.

## What has and has not been tested

**Verified:** 138 unit tests — pitch spelling across all 15 major keys against
all 88 keys, MIDI parsing, the sustain-pedal state machine, staff assignment,
keyboard geometry, the practice state machine (chords, ties, both modes,
seeking, lookahead, the chord timing window), score building from cursor
steps, chord-attempt expiry, and the OSMD adapter's traversal against a
synthetic OSMD. Plus 46 end-to-end checks in headless Chromium covering both
app modes, score loading, the cursor/rest mapping, legato advancing, tempo
mode, keyboard colour precedence, chord timing with real elapsed time, a
device reporting a useless timestamp, the fixed layout under a long PDF and
a short window, and real multi-page PDF rendering.

**Not verified:** the two libraries that could not be installed in the
environment this was built in — **VexFlow** (the free-play grand staff) and
**OpenSheetMusicDisplay** (the practice-mode engraving). Their call sequences
were checked against recording stubs and their APIs against published source,
but the real libraries have never run. Both are wrapped so a failure shows a
message rather than a blank page:

- Staff problems → the error prints under the staff (`ui/GrandStaff.tsx`).
- Score-reading problems → a "read with N warnings" panel appears listing what
  the adapter could not find, with the property paths it did resolve. If OSMD
  has renamed something, that panel says which thing.

## When something does not work

Practice mode has a **"What the app is hearing"** panel under the score. It
shows the notes the app is waiting for, and the last eight keys it received
with what it made of each: counted, not in this chord, already had it, or too
late. Between them those distinguish the three ways this can fail — notes not
arriving at all, arriving at a pitch the score does not expect, or arriving
correctly but spread too wide for the chord window.

## Ideas for later

- Note extraction from notation-software PDFs (see above)
- Chord naming from the sounding notes
- Hand colouring on the keyboard, taken from the staff each note sits on
- Repeats and da capo handling in the practice cursor
- Saving progress per piece
