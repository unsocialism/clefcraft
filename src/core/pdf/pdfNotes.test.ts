import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chooseFontProfile, chooseStaff, FONT_PROFILES } from './pdfNotes.ts';
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
