import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chooseFontProfile, chooseStaff, FONT_PROFILES, keyChangesOn } from './pdfNotes.ts';
import type { Glyph } from './glyphs.ts';
import type { Staff } from './staffGeometry.ts';

/** A staff built from its top line downward, as PDF coordinates run. */
const staffFrom = (topLineY: number, spacing = 4.61): Staff => ({
  lineYs: [0, 1, 2, 3, 4].map((i) => topLineY - i * spacing),
  spacing,
  x0: 46,
  x1: 559,
});

describe('choosing the staff a notehead belongs to', () => {
  it('takes the nearest when both staves fit the grid equally', () => {
    const upper = staffFrom(700);
    const lower = staffFrom(650);
    // Sitting on the upper staff's bottom line.
    assert.equal(chooseStaff(100, 700 - 4 * 4.61, [upper, lower]), upper);
  });

  it('prefers the staff the notehead actually lands on, not the closer one', () => {
    // Taken from the real failure: a ledger-line note above the lower
    // system of the page sat 10.3 half-spaces from the staff above it and
    // 12.0 from its own — but only its own staff's grid fits.
    const above = staffFrom(661.93);
    const own = staffFrom(610.54);
    const y = 628.97;

    // Check the premise, so this test fails loudly if the fixture drifts.
    const halfSpace = 4.61 / 2;
    const stepsToAbove = Math.abs((y - (661.93 - 2 * 4.61)) / halfSpace);
    const stepsToOwn = Math.abs((y - (610.54 - 2 * 4.61)) / halfSpace);
    assert.ok(stepsToAbove < stepsToOwn, 'the wrong staff must be the nearer one');

    assert.equal(chooseStaff(271.9, y, [above, own]), own);
  });

  it('ignores a staff the note is horizontally outside of', () => {
    const narrow: Staff = { ...staffFrom(700), x0: 400, x1: 559 };
    assert.equal(chooseStaff(100, 700, [narrow]), null);
  });

  it('refuses a notehead too far from any staff to be on ledger lines', () => {
    const staff = staffFrom(700);
    // Forty half-spaces below the middle is far past any ledger line.
    assert.equal(chooseStaff(100, 700 - 2 * 4.61 - 40 * (4.61 / 2), [staff]), null);
  });

  it('still places an off-grid notehead when nothing fits', () => {
    const staff = staffFrom(700);
    const between = 700 - 4.61 / 4; // a quarter space off any position
    assert.equal(chooseStaff(100, between, [staff]), staff);
  });
});

describe('choosing a font profile', () => {
  const glyph = (ch: string): Glyph => ({ ch, x: 0, y: 0, size: 128, advance: 7 });

  it('picks the profile that finds noteheads on the page', () => {
    // Sibelius Opus puts its glyphs on ordinary Latin characters.
    const opus = [glyph('œ'), glyph('œ'), glyph('˙')];
    assert.equal(chooseFontProfile(opus).profile.name, 'Opus');

    const smufl = [glyph(''), glyph('')];
    assert.equal(chooseFontProfile(smufl).profile.name, 'SMuFL');
  });

  it('recognises MuseScore 2\'s own MScore font', () => {
    // From a real MuseScore 2 export: filled and half noteheads.
    const mscore = [glyph('\ue12d'), glyph('\ue12d'), glyph('\ue12c'), glyph('\ue19e')];
    const picked = chooseFontProfile(mscore);
    assert.equal(picked.profile.name, 'MScore');
    assert.equal(picked.noteheads, 3);
    assert.equal(picked.profile.clefs['\ue19e'], 'treble');
    assert.equal(picked.profile.clefs['\ue19c'], 'bass');
    assert.equal(picked.profile.accidentals['\ue114'], -1);
  });

  it('reports zero when the page has no recognisable noteheads', () => {
    // A scan, or a font neither profile knows.
    assert.equal(chooseFontProfile([glyph('x'), glyph('y')]).noteheads, 0);
  });

  it('counts the hollow notehead, not the augmentation dot', () => {
    const opus = FONT_PROFILES.find((p) => p.name === 'Opus')!;
    // U+02D9 is the half/whole notehead; U+2122 is the dot that sits after
    // a note and appears about as often, which is what makes it tempting.
    assert.ok(opus.noteheads.has('˙'));
    assert.ok(!opus.noteheads.has('™'));
  });
});

describe('key changes part-way along a staff', () => {
  const MSCORE = FONT_PROFILES.find((p) => p.name === 'MScore')!;
  const staff = staffFrom(700, 5);
  const bottom = 700 - 4 * 5;
  // y of a treble-clef staff position: 0 = bottom line (E4), 1 = F4, …
  const at = (step: number) => bottom + step * 2.5;
  const g = (ch: string, x: number, y: number): Glyph => ({ ch, x, y, size: 20, advance: 6 });
  const FLAT = '\ue114';
  const SHARP = '\ue10e';
  const HEAD = '\ue12d';
  const clefs = [{ x: 50, clef: 'treble' as const }];

  it('reads a new key written right after a barline', () => {
    // Barline at 300, then B♭ and E♭ (middle line and top space), then notes.
    const glyphs = [g(FLAT, 304, at(4)), g(FLAT, 310, at(7)), g(HEAD, 330, at(2)), g(HEAD, 350, at(3))];
    const changes = keyChangesOn(staff, glyphs, MSCORE, clefs, [46, 300, 559]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.x, 300);
    assert.deepEqual(changes[0]!.key, { B: -1, E: -1 });
    assert.equal(changes[0]!.fifths, -2);
  });

  it('does not mistake a note\'s own accidental after a barline for a key change', () => {
    // A sharp directly before its notehead, at the same height.
    const glyphs = [g(SHARP, 304, at(1)), g(HEAD, 312, at(1))];
    assert.deepEqual(keyChangesOn(staff, glyphs, MSCORE, clefs, [46, 300, 559]), []);
  });

  it('leaves the opening key signature of the line to keySignatureOn', () => {
    const glyphs = [g(FLAT, 60, at(4)), g(HEAD, 90, at(2))];
    assert.deepEqual(keyChangesOn(staff, glyphs, MSCORE, clefs, [46, 559]), []);
  });
});
