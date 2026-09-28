# clefcraft

Reads a digital piano over MIDI and shows what you played — as a note name, as
lit keys on an on-screen keyboard, and as real notation. It runs in the
browser and installs on a phone like an app; see [DEPLOY.md](DEPLOY.md).


<img width="861" height="403" alt="image" src="https://github.com/user-attachments/assets/49664cfb-cc30-4d53-b2bd-5b99ffdcdb95" />


## Three modes:

- **Free play** — play anything; see the note names, the last few moments
  written on a staff, and your playing rising off the keys — and record it as
  sheet music you can keep.
- **Practice** — open a MusicXML file, a PDF or a MIDI file. The keyboard lights the keys
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
| `.mid`, `.midi` | Engraved by clefcraft itself | **Yes** — with real rhythm |

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
using the clef and key signature it finds (`core/pdf/pdfNotes.ts`). Three music
fonts are mapped: Sibelius's Opus, the standard SMuFL fonts (MuseScore 3
and 4's Leland, Bravura), and the MScore font of MuseScore 2. Key changes
part-way along a line are read, and flat beams — which some exports draw
as long lines inside the staff — are not mistaken for staff lines.

Measured on the two files it was built against: a MuseScore export read
434 of 434 notes and 95 of 95 measures correctly; a Sibelius export gives
747 notes with none off the staff grid.

What it does not read is **rhythm**. The notes are in the right order and
chords are grouped, but durations are unknown — so a PDF works in *wait for
me* mode and not in *play along*.

### Reading a scanned PDF

A scan is a photograph of a page. There are no glyphs and no coordinates in
it, so when a PDF turns out to have none, the page is drawn as pixels at
three hundred dots an inch and *looked at* instead
(`core/pdf/raster.ts`, `core/pdf/scanInk.ts`). What comes out is written in
exactly the form the drawn reader produces — staff-line rules, barline
strokes, glyphs at positions — so everything downstream works on a scan
without knowing it is one: the staves, the pitches, the page overlay, the
corrections, the export.

How it reads a page:

- **The tilt comes out first.** A scan is never square, and a third of a
  degree smears a staff line across three rows, which is enough to lose it.
  The tilt is measured in bands down the page rather than once for the whole
  of it, because a book is photographed open and the paper curves — on the
  scan this was built against the top of the page is tilted by a different
  amount from the bottom.
- **Staff lines are the rows that run.** Not the rows with the most ink — a
  bar of sixteenths has more — but the rows that reach from one end of the
  system to the other. They are then gathered into fives, and a group that
  is not five is dropped rather than guessed at.
- **Noteheads are what a rectangle fits inside.** Filled heads are found by
  opening the page with a rectangle a little smaller than a notehead: stems
  are too narrow, beams, slurs and ledger lines too thin, and text too small,
  so almost everything else disappears and the heads stay. A hollow head is
  found as a piece of enclosed paper instead. Each head's height is then
  measured again on the untouched ink, down a narrow band through its middle:
  half a space of error there is a whole step of pitch.
- **The key signature is settled by a vote.** A piece has one key signature
  and repeats it on every line, so every line's reading is a ballot. Each is
  read by matching the *positions* of the marks after the clef against the
  fifteen standard signatures — a sharp and a natural differ by a few pixels
  of slant at this size, while a sharp on the top line and a flat on the
  middle line are four half-spaces apart and cannot be confused. The winner
  is then written on to every staff, including the lines where the marks
  themselves were lost in a slur.
- **Clefs are told apart with a ruler.** A treble clef loops well below the
  bottom line and a bass clef never leaves the top half, so counting the ink
  under the staff separates them — no outlines to match, nothing to train.
  Where the ink says nothing, a piano system is a treble staff over a bass
  one, and that is used instead.

**What to expect.** On the 300dpi scan it was built against — four pages,
twenty systems — it found every staff, every clef, the right key signature,
and about 670 noteheads, with nine in ten sitting within a third of a
half-space of a staff position. It is not as exact as a score exported from
notation software, and it never will be: *Mark what was read* and *Correct
notes*, below, are how you check it. Reading takes a couple of seconds a
page, so a long book is a wait.

Rhythm is not read, exactly as for any other PDF. A very faint, very
crooked or heavily marked-up scan may find no staves at all, and says so.

**Checking and correcting the reading.** *Mark what was read* puts a marker
on every notehead it found, coloured by hand, and writes above each staff
the clef and key signature it used there — "treble · G major (1♯)". That is
the one thing a reading can get wrong that the markers themselves cannot
show: every note on a staff read with the wrong clef is out by a sixth, and
every F on a staff read without its sharp is out by a semitone, and in both
cases the markers sit neatly where they belong. A clef or key that changes
part-way along the line is written as a chain, "treble→bass". *Label
pitches* adds the pitch read at each notehead, so a wrong note is obvious at
a glance. *Correct notes* lets you:

- tap a marker to move it a semitone or an octave, switch its hand, or delete it
  (on a keyboard: ↑↓, Shift+↑↓, H, Delete, Esc);
- tap an empty spot on a staff to add a note that was missed;
- undo, or discard every correction.

Corrections are stored as changes to the reading, not as an edited copy, and
are saved as you make them.

**A correction stays on the notehead it corrects.** Changing a note's pitch
does not move its marker up or down the staff, and deliberately: the marker
points at ink on the page, and the notehead the reader misread is still
printed exactly where it is. Moved to where the corrected pitch would be
written, the marker would hover over blank paper — or over a different
printed note — and you would lose track of which one you had fixed. Nothing
but the display depends on that height, so the pitch you set is the pitch
practice waits for and the pitch the export writes.

What does change is the marker: a corrected or added note is tinted violet
(dashed if you added it) and carries its new pitch whether *Label pitches*
is on or not. Every other marker can be checked against the page underneath
it; this one cannot, because it no longer agrees with what is printed there,
which is the whole point of it.

**Taking the notes out.** *Save MIDI* and *Save MusicXML* write the reading,
corrections included, to a file. Rhythm is not read from a PDF, so every
event becomes one quarter note and a measure lasts as many quarters as it
has events: pitches, chords, hands and barlines are right, note lengths are
not. MusicXML opens in MuseScore, where the rhythm can be set by hand.

### MIDI files

A MIDI file states exactly when every note starts and stops, so it is the
one source where *play along* works from the piece's own rhythm. What it
does not state is how the music is written, so clefcraft engraves it
(`core/score/midiScore.ts`, drawn by `ui/score/MidiSheet.tsx`) and makes
three decisions on the way:

- **Timing is rounded to the nearest sixteenth.** A performance played in by
  hand has no exact durations; taken literally, every bar would be a thicket
  of dotted sixty-fourths.
- **Each hand is written as one line of rhythm.** Notes starting together
  become a chord, and a held note is cut short when that hand plays again.
  Real piano writing has two or three voices per staff; separating them
  reliably is a research problem, not a rounding decision.
- **The hands come from the file** when it has two tracks or two channels —
  the lower one is the left. Otherwise they are split by pitch, at middle C
  by default, with a control to move the split.

A note crossing a barline is split and tied, the key signature and time
signatures are taken from the file, and percussion (channel 10) is left out.
So the notation is a fair reading of the performance rather than a
reconstruction of the original score; the pitches and their order are exact.

## The live view

Two views of the same playing, one answering *what* and the other *how*. The
running staff belongs to free play; the roll is above the keys in all three
tabs, and in Practice and Training it says whether the note was the one asked
for. Each tab starts with a clear strip — what you played in another one is not
what you are playing here.

**A written sheet** (free play). What you play is written out as a page of
music: four bars to a line, filling from the left, a new line when the last one
is full. It was a row of slots filled from the right, with the whole staff
marching sideways as each note arrived; that read like a ticker tape, and it is
not what music looks like.

The thing it guarantees is that **nothing already written ever moves**. Notes
land on a grid decided before you play — a bar of nothing is formatted first
and the real notes are placed where its four beats fell — so a note that gains
a ledger line or an accidental does not push its neighbours along. When the
page is full a whole line leaves the top rather than a note at a time, so it
turns once every sixteen notes instead of shuffling upward constantly. The note
just played is blue, to show where the writing has got to.

A chord is one moment, not three notes — the few milliseconds between the keys
of a chord are not three separate events. There is **no rhythm** in it: every
press takes the next beat, whatever you held. Free play is played to no clock,
and a rhythm guessed from it would have to be re-guessed, and the page
re-written under your hands, with every note you added; the roll below shows
how long each key was down. What the sheet shows is which notes they were.

How many lines it writes depends on the room it has: four on a tall window,
one on a phone. Under about 560 pixels of width it writes two bars to a line
instead of four, the way music printed for a small page does — sixteen places
for a note across a phone leaves twenty pixels each, which is less than a chord
with an accidental needs. On a screen too short for even one system it draws
the sheet whole and scales it down rather than cutting the bass staff off.

**A piano roll** (every tab). Above the keys, each note appears the moment it
is struck, grows while you hold it, and drifts up and out — the half the staff cannot tell
you: how long each key was down, and how evenly the notes fell. It travels at a
set speed, 88 pixels a second, rather than holding a set number of seconds of
history: a second of playing then draws the same bar whatever the strip's
height, instead of a sliver you have to squint at on a short one. It is pitched
so that notes of the length people actually play are worth looking at — half a
second fills half the strip, a second and a bit fills it — which costs history:
a little over a second of it is on screen at full height. That is the right way
round: the strip is for how you are playing now, and the staff above it is what
remembers. It is drawn on a canvas inside the keyboard's own strip, and takes its
mapping straight from the keyboard's own transform (`getScreenCTM`), so a note
sits over its key at any size and scrolls sideways with the keys on a phone.
Working that mapping out a second time from the width is what put the notes out
of line on a phone in landscape: the keyboard's SVG fits its drawing to its box,
so once the box is wider than it is tall enough for, the *height* sets the scale
— and a copy of the formula that only knew about width drifted by tens of pixels
towards the ends. When
nothing is sounding and nothing is still on screen it stops animating and looks
again a few times a second, so an open tab on a phone is not sixty wasted
frames a second.

**Right and wrong, where something is judging.** In Practice and Training each
note is coloured by what the engine made of the press: green for the note that
was asked for, red for a wrong key, amber for the right key played too late to
count as part of its chord. Free play judges nothing, so everything there stays
plain blue. It is a record, not a hint — nothing is coloured until after you
have played it, so Training's rule that the keyboard stays dark until a wrong
key is untouched, and a run of stumbles is visible as a pattern rather than as
a number at the end.

The roll and the practice engine never meet: each stamps a press with its own
reading of the clock, and the two are matched by pitch and time — the nearest
press of the same pitch within a tenth of a second is that press, since nobody
plays a key twice that fast. A verdict is kept once seen, because the engine
remembers only the last eight presses and a note stays on screen longer than
that in a quick passage; a note that turned green must not turn blue again as
it rises.

## Recording free play

*Record* in free play keeps what you play and writes it out. A take is not a
special kind of thing: it is turned into a MIDI file, and from there it takes
the same path as any MIDI file you might open — engraved by clefcraft, kept in
*Your scores*, practised against in either mode, or downloaded as a `.mid` for
MuseScore or a DAW. What you see under the keyboard is exactly what gets saved.

Writing playing down means three decisions, and they are the difference
between a readable page and a thicket:

- **The tempo is found, not assumed.** Nothing was played to a click, so the
  written tempo is a choice — but not an arbitrary one. Onsets are rounded to
  sixteenths when the music is engraved, so the tempo that lands them nearest
  the sixteenths is the one that writes down what was actually played. A scale
  played at 550ms a note is eight clean quarter notes at 107bpm; called 90bpm
  the same playing is dotted eighths, ties across the barline and sixteenth
  rests. Half and double a tempo fit equally well — the same playing written in
  eighths or in half notes — so the one where a step from note to note is about
  one beat wins. The control beside the take offers a few round tempos as well,
  because a take that reads oddly usually reads better at one of them.
- **Notes are joined up.** Nobody holds a key for its full written value.
  Taken literally, an ordinary line of quarter notes comes out as dotted
  eighths separated by sixteenth rests, so a note released just before the next
  one is written as lasting until it. Only ever lengthened: a held bass under a
  moving line keeps its length, and a real staccato keeps its rest.
- **The pedal is left out.** Pedalled playing recorded faithfully is a page of
  overlapping long notes tied together — a fair record of the sound and a poor
  record of the playing. What is written is what your fingers did.

What it does not do is follow you. There is no click and no beat tracking
beyond the tempo fit, so playing that speeds up and slows down drifts away from
the grid, and the further in you get the stranger the rhythms look. Takes of a
few lines come out well; a whole rubato piece does not. The pitches and their
order are always exact.

Leaving the Free play tab stops a recording, since the keys then belong to
whichever tab you moved to. A take stops by itself after ten minutes.

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
MusicXML the score also scrolls itself to keep the current note in view.

**The keyboard follows what you play.** Eighty-eight keys at a size worth
tapping are wider than a phone, so on a phone held upright the strip shows
about half of them and scrolls sideways for the rest. It moves itself to keep
the keys that matter on screen — the ones a score or exercise is asking for,
and the ones under your fingers — in every mode, so a note you play at the top
of the keyboard brings that end into view along with its bar in the live roll.
It only moves when something needed is actually off the edge: play inside the
window you have and nothing shifts, and a position you scrolled to by hand
stays where you put it. Where what you are playing and what is being asked for
cannot fit in one window — a wrong note two octaves down — it stays with what
the score wants. A soft fade at whichever end has more behind it is what says
the keyboard carries on that way. On a screen wide enough for all 88 keys
nothing scrolls and there is no fade.

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
whatever you set), and keeps going whether you keep up or not. Three things
make it followable:

- **A count-in.** One bar of the piece's own meter before the music moves,
  counted in big figures over the page, so you come in with it rather than
  chasing it from a standing start. It is given every time you press Play,
  including after a pause, but not when you only move the tempo slider, and
  not between the passes of a repeated section — see below. The
  sweeping line does not wait through it: it runs up to the first note and
  arrives exactly on the downbeat, so the count is something you see as well
  as read. Where there is music to the left of the cursor on the same line it
  runs up through that music at the speed it is about to keep — a bar of
  count-in is a bar of travel, like a conductor's upbeat. Where there is not,
  because the piece starts there or the bar before is on the line above, it
  comes in from the left edge of the line instead; running up there and
  jumping back down would read as a mistake.
- **A sweeping line.** On a MIDI score, a violet line glides across the
  staves in time with the clock, showing you the beat coming instead of
  leaving you to infer it from the note that has just gone past. It follows
  where the notes were actually engraved, but only halfway: engraved spacing
  is not proportional to time — an engraver may leave 26 units between two
  eighth notes or 54 — so a line pinned strictly to the noteheads doubles
  and halves its speed within a bar, which lurches. Pulling it halfway
  towards even time keeps it within a few units of every note while more
  than halving the change in speed. Each bar also hands the line to the
  first note of the *next* bar rather than stopping at its own barline, so
  it crosses barlines without a jump; at the end of a line it stops at the
  barline, because the next bar is not beside it but below it.
- **A beat pulse.** A dot per beat of the bar beside the tempo slider,
  lighting up as the bar comes round: a metronome you can see, since the app
  makes no sound.

The line and the pulse are driven straight from the clock rather than from
React state, so they move every frame without re-rendering the app sixty
times a second.

Both modes count mistakes and clean events, and you can jump to any measure.

## One hand at a time

**Both hands · Right hand · Left hand**, beside the mode buttons. Picking a
hand makes the whole of practice about that hand: the cursor stops only where
that hand plays and walks straight past the moments the other one has to
itself, the keyboard lights up only its keys, and a section counts a clean
pass by its notes alone. It works in both modes, with a repeated section, and
whether the music came from a MIDI file, a MusicXML file or a PDF — the hand
is the staff a note was written on, which every source carries.

**The other hand stays on the page, greyed back.** Notes, beams and ties all
go pale, so you can still see what the other hand is doing and where you are
in the piece without it asking to be played. That is drawn on MIDI scores,
which the app engraves itself; a MusicXML or PDF score is somebody else's
page and cannot be redrawn, so there only the guides and the cursor change.
The "play this now" band shrinks to the hand you are practising too, rather
than reaching across a staff nothing is asking you for.

**The other hand can come along for the ride.** Its notes are not counted
correct and not counted as mistakes — they pass without comment, so a pass
stays clean if your left hand joins in while you work on your right. A note
counts as the other hand's when that hand plays it within two quarter notes
of where the cursor is; the two hands do not move together, so some latitude
is needed, but a note it plays four bars later is still a wrong note. Notes
of the hand you *are* practising are judged exactly as before.

Switching hands mid-piece lands on the nearest moment the new hand plays and
starts the mistake count again — it is a different thing being practised. The
choice is deliberately forgotten when you reload: a piece opened tomorrow
should ask for both hands, where a remembered "left hand only" would look
like a score with half its notes missing.

## Repeating a section

*Repeat a section* turns the piece into the few bars you are actually working
on: give it two bar numbers and it plays those bars round and round, in either
mode, without you reaching for the mouse between attempts. Bar numbers rather
than clicks on the page, because bars are how you would say it to a teacher —
"nine to sixteen" — and they mean the same whether the music came from a MIDI
file, a MusicXML file or a PDF. Numbers the wrong way round mean the same
section, numbers past the end are pulled back to it, and on an engraved MIDI
score the bars are tinted on the page so the section is visible with the
controls hidden.

- **Wait for me** turns round when you play past the last note of the section.
- **Play along** turns round the instant the clock reaches the end of it.
  Nothing in between: no count-in, and not even the fraction of a beat the
  frame overshot the end by, which is handed on to the next pass so that its
  first note falls exactly where the note after the last would have. A
  section practised this way is a loop you can play against — the price is
  that you have to get your hands back to the start in the time the music
  gives you, which is the point. **Count me in to start** gives you the bar
  of counting when you press Play, and only then; the tick is remembered
  between sessions.
- **It counts the passes**, and how many of them were clean. A pass is clean
  when you played every note of the section and none of them wrong. Both halves
  matter: without the first, a section left running while you make tea would
  count clean pass after clean pass.
- **Speed up when clean** (play along) raises the tempo five beats a minute
  after every clean pass, up to 200. Start a passage slower than you can manage
  and it builds itself up, which is what a teacher would have you do by hand.
  It is capped at the top of the tempo slider rather than at the piece's own
  written tempo: capping it there makes the setting do nothing at all when you
  are already at that tempo, which reads as broken rather than as considerate.
  The new tempo is picked up by the clock on its next frame, from where the
  music has got to, so the section does not stop to change gear.

Moving the cursor — by looping, by the measure box, by Restart — starts the
engine's counters again, so "clean" and "wrong" under the progress bar are
this pass rather than the whole session.

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
      midiFile.ts       reading a standard MIDI file
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
      midiScore.ts      a MIDI file -> rhythm, hands, bars and engraving
      exportScore.ts    a reading -> a MIDI or MusicXML file
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

**The controls strip scrolls when the screen is short.** The shell gives the
music and the keyboard their room first, so on a phone the control strip is
the one that gets squeezed — and before it scrolled, its bottom rows were
simply cut off and unreachable. On a desktop nothing about it changes; there
is nothing to scroll.

**The note readout is a fixed height.** The names of the notes you are
playing are twice the size of the "Play a note" hint they replace, so a box
sized to its contents grew by sixteen pixels the instant a key went down and
shrank again when it came up — shoving the record panel and the music down the
page and back on every keypress. It is now one height either way, and a chord
too wide for it scrolls sideways inside it rather than wrapping, which would do
the same thing.

**One hand is a filter, not a second score.** Practising the right hand does
not build a right-hand score and hand it to the engine; it passes the choice
down to the one place that decides what a moment asks for. Everything else —
the cursor, the guides, the section counter, the play-along clock — already
went through there, so they all learnt one hand at once, and a score still
means the same thing to the library, the exporter and the page.

**A scan needs the picture at the right size.** Rendering the page at 200
dots an inch, which sounds like plenty, loses more than half the staff lines:
the scan itself was made at about 300, and sampling it below that thins the
lines until they are one faint pixel with gaps. Rendering higher than the
scan was made costs time and adds nothing. Three hundred is where scans
people actually have sit; if nothing is found there the page is drawn again
at four hundred, for the finer scan.

**The clock reads the tempo rather than remembering it.** It used to close
over the tempo, which meant every change of tempo tore the clock down and
built it again: the pass began afresh, the cursor snapped back to the event
it was on, and a section that sped itself up after a clean pass paused to do
it. The tick now reads the tempo each frame and, when it has changed, rebases
on to it where the music actually is — so the slider is heard as a change of
speed rather than as a jump, and a section going round can change gear
without stopping.

**A staff never has a key of its own.** Both staves of a grand staff carry
the same key signature — that is not a convention an engraver may depart
from — so a staff that reads no sharps and no flats while the staff beside
it reads three has not found a key, it has missed one, and every note on
that line then comes out a semitone wrong with nothing on the page to say
so. Such a staff takes its neighbour's key. Two staves that read two
*different* keys are left alone: keys change from one system to the next,
and that is a disagreement worth seeing rather than one to paper over. A
cancellation to C major is written as naturals on both staves, so it sums to
nothing on both and neither is touched.

**On-grid beats near, but not from any distance.** Which staff a notehead
belongs to is settled in the drawn reader by the grid: a notehead lands
exactly on a line or a space of its own staff and between the lines of every
other, so an on-grid staff used to win however far away it was. On a scan a
height is right to a pixel or two, so a note can miss its own staff's grid
and hit that of one three staves away by arithmetic alone — which put notes
beside the bass staff three octaves below the treble. A staff two spaces
further off now has to earn it.

**The edge fade is a mask, not an overlay.** A gradient drawn over the ends of
the keyboard strip would sit between you and the keys underneath, swallowing
taps on the lowest and highest notes on screen. `mask-image` on the scrolling
box fades the same pixels without adding anything to hit, and because a mask
applies to the box rather than its contents, the fade stays pinned to the
edges of the screen instead of scrolling away with the keys.

**A dot is two things in VexFlow, and `Dot` only draws one of them.**
`Dot.buildAndAttach` adds the dot glyph; it does not add the half again to
the note's *ticks*. A dotted note built that way is still formatted as an
undotted one, so every note after it in that hand lands early and the two
staves drift apart on the page — visible on any MIDI file with a dotted
quarter in the left hand. The dots have to be declared in the note itself
(`new StaveNote({ ..., dots })`) as well as drawn.

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

**Verified:** 482 unit tests — among them pitch spelling across all 15 keys
and all 88 notes, MIDI parsing, the sustain pedal, the practice state
machine and its chord window, PDF reading against real Sibelius and
MuseScore exports, corrections, the device library, the training
generator (ranges, stepwise motion, hand changes, accidentals, intervals),
the free-play recorder (pairing releases with presses, chords, the pedal,
joining notes up, and the tempo fit), and the live trail (held notes, chords
as moments, and what is forgotten), and the keyboard's follow-the-keys rules
(staying put when everything is in view or when nothing is being played,
centring a key off either edge, keeping a hand-scrolled position, holding a
guide and a played key together, preferring the guide when they cannot fit,
and which end has more keyboard behind it), and practising one hand (what a
moment asks for, starting and seeking by way of that hand, walking past the
moments only the other hand plays, playing a piece through with one hand,
the other hand's notes passing uncounted while its own wrong notes still
count, a note the other hand plays far away still counting as a mistake, the
guides and a section's note count following the choice, the play-along cursor
stopping only where that hand plays, and a unison between the staves
belonging to both), and reading a scan (ink from pixels, measuring and
taking out a tilt including one that varies down the page, finding staff
lines and refusing a group that is not five, erasing the lines without
cutting the symbols, keeping only shapes of a notehead's size, finding
blobs and enclosed holes, stems and column slices, reading each of the
fifteen key signatures by position and refusing a stray mark, telling the
clefs apart, and reading a whole drawn page back as the pitches it was
drawn with), the free-play sheet (each press taking the next slot, a
chord growing in the slot it already has, a note never moving once written,
the oldest forgotten when the page is full, a line turning whole, a cleared
trail starting a fresh sheet, and a page laid out into fewer lines when there
is room for fewer), and a staff taking its neighbour's key signature when it
read none of its own (including when what it read was a lone natural, but not
when it read a different key, not from a staff a system away, and not on a
piece that really is in C major).
End-to-end in headless Chromium: all three modes, PDF reading and
correcting, the library across reloads, offline use through the service
worker, playing training exercises through (including a simulated MIDI
piano for the chord timing), the play-along count-in, sweeping line and
beat pulse (counted in at the right note, sweeping between the right ones,
no second count-in when the tempo slider moves, and the line running up to
the downbeat from the left edge at the top of a piece and through the bar
before when resuming mid-line), and the hide-the-controls
gestures at phone size, repeating a section (a pass counted in each mode, a
pass with a wrong note not counted clean, a pass nobody played not counted
clean either, the tempo climbing 60-65-70-75 on clean passes played to the
guides, and the same on a PDF score; and the loop coming round with no break
in it — one bar of counting at the start and none after, every pass lasting
one bar to within a frame at 100bpm, and still within a frame of the bar
while the tempo climbed 60-65-70-75-80-85 underneath it), and recording free play end to end — played in,
written out, saved, reopened from the library and read back as a score, and
the live view — the trail marching, the roll animating only while something
is moving, each note drawn over its own key to the pixel at both desktop and
phone widths, and the roll colouring right and wrong in Practice and Training
while staying plain in free play. The keyboard following what you play was
checked at phone width: a note two octaves above the visible keys scrolls
itself into view in free play and in training, a note already on screen moves
nothing, the fade flips from one end to both to the other as the strip
scrolls, a desktop-width window shows neither, the guides stay in view
note by note through a MIDI score, a wrong note two octaves below does not
pull the view off them, and the roll's bars still land on their keys to the
pixel with the strip scrolled. The written sheet was checked in the browser at
four window sizes: it fills its panel exactly and nothing hangs over the edge
at any of them, notes land left to right and every one of them stays at the
pixel it was written at as more arrive, a chord comes out as one stack, and
leaving free play and coming back starts a fresh page. Practising one hand was checked in the
browser on a real MIDI file and on a PDF: the guides drop to that hand's
notes, the other staff greys back to the pixel colour counted off the drawn
page (and back again when both hands are chosen), the band shrinks to the
hand being practised, a clean pass of a repeated section is still counted
clean with the left hand playing along, a wrong note of the practised hand is
still counted, and the play-along cursor lights only that hand's keys. The training sheet was checked with the real VexFlow.

Reading scans was checked against a real one: a four-page 300dpi scan of a
published piano arrangement, tilted by half a degree and assembled from two
exposures a page. All forty staves and every clef were found, the key
signature was read unanimously, about 670 noteheads came out with a median
position error of a fifteenth of a half-space, the first system's pitches
were checked note by note against the page, and the whole of it went through
the app end to end — read in eight seconds, practised through with the
keyboard guides, one hand at a time, and opened in *Correct notes* with a
marker on every note found.

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

## Which version am I looking at?

The name in the top left is followed by the version and the date it was
built — `v0.4.0 · 23 Sep` — with the exact commit in the tooltip. An
installed app that has quietly kept an old copy shows an old date, which is
the quickest way to tell. The version comes from `package.json`; bump it
when a release is worth naming. The date and commit are filled in by the
build (`vite.config.ts`).

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

- Rhythm from PDFs, so play-along works for them too (MIDI files already do)
- Chord naming from the sounding notes
- Repeats and da capo handling in the practice cursor
- Exporting and importing your corrections as a backup
