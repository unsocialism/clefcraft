import { useMemo } from 'react';

import { noteName, spellNote, type AccidentalPreference } from '../core/music/pitch.ts';

export interface NoteReadoutProps {
  readonly notes: readonly number[];
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
}

/** Plain-text name of what is sounding: the headline answer to "what note is that?". */
export function NoteReadout({ notes, fifths = 0, accidentals = 'auto' }: NoteReadoutProps) {
  const names = useMemo(
    () => notes.map((midi) => noteName(spellNote(midi, fifths, accidentals))),
    [notes, fifths, accidentals],
  );

  if (names.length === 0) {
    return (
      <div className="readout readout--empty" aria-live="polite">
        <span className="readout__hint">Play a note</span>
      </div>
    );
  }

  return (
    <div className="readout" aria-live="polite">
      {names.map((name, index) => (
        <span key={`${name}-${index}`} className="readout__note">
          {name}
        </span>
      ))}
    </div>
  );
}
