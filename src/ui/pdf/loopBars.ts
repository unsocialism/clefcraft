/**
 * Where each bar of a PDF sits on the page.
 *
 * The reader records, for every staff, the barlines it found and how many
 * bars came before the system — which is all that is needed to say where bar
 * nine is: between the eighth barline of its system and the ninth. That is
 * the same arithmetic the reader itself uses to number a notehead's bar, so
 * a bar marked here is the bar the practice engine means.
 *
 * Positions are in PDF points, with Y increasing upward. The caller flips.
 */

import type { PdfPageLayout, StaffInfo } from '../../core/pdf/pdfNotes.ts';

export interface PdfBar {
  readonly measure: number;
  readonly left: number;
  readonly right: number;
  /** Every staff of the system, top line first, in PDF Y. */
  readonly staves: readonly { readonly top: number; readonly bottom: number }[];
  /** One staff space, for sizing anything drawn on it. */
  readonly spacing: number;
}

/**
 * The bars of one page, in reading order.
 *
 * A system's bars are taken from its top staff: the two staves of a grand
 * staff are barred together, and reading both would give every bar twice.
 * The leftmost barline opens the system rather than dividing it, so a system
 * holds one bar fewer than it has barlines — the same rule the reader counts
 * measures by.
 */
export function barsOfPage(layout: PdfPageLayout): PdfBar[] {
  const systems = new Map<number, StaffInfo[]>();
  for (const info of layout.staffInfo) {
    const found = systems.get(info.system);
    if (found) found.push(info);
    else systems.set(info.system, [info]);
  }

  const bars: PdfBar[] = [];
  for (const [, staves] of [...systems].sort((a, b) => a[0] - b[0])) {
    const ordered = [...staves].sort((a, b) => a.staffNumber - b.staffNumber);
    const top = ordered[0];
    if (!top) continue;
    const bands = ordered.map((info) => ({
      top: info.staff.lineYs[0] ?? 0,
      bottom: info.staff.lineYs[4] ?? 0,
    }));
    const barlines = [...top.barlines].sort((a, b) => a - b);
    for (let i = 1; i < barlines.length; i++) {
      bars.push({
        measure: top.measureBase + i,
        left: barlines[i - 1]!,
        right: barlines[i]!,
        staves: bands,
        spacing: top.staff.spacing,
      });
    }
  }
  return bars;
}
