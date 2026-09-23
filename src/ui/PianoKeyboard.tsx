import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { keyboardLayout, type KeyRect } from '../core/music/keyboard.ts';
import { noteName, pitchClassName, spellNote } from '../core/music/pitch.ts';
import type { AccidentalPreference } from '../core/music/pitch.ts';

const WHITE_KEY_PX = 26;
const KEYBOARD_HEIGHT_PX = 132;

export type Hand = 'right' | 'left' | 'both';

/** A key the score says to play, how far ahead it is, and with which hand. */
export interface KeyGuide {
  readonly midi: number;
  /** 0 = play now, 1 = next, 2 = the one after. */
  readonly distance: number;
  /**
   * Which hand the score gives this note to. `both` is a unison between the
   * staves — the same key written in each hand at once.
   */
  readonly hand?: Hand;
}

export interface PianoKeyboardProps {
  /** MIDI numbers currently sounding. */
  readonly active: readonly number[];
  /** Keys the loaded score is asking for. Empty in free-play mode. */
  readonly guides?: readonly KeyGuide[];
  readonly lowest?: number;
  readonly highest?: number;
  readonly fifths?: number;
  readonly accidentals?: AccidentalPreference;
  /** Label every sounding key with its note name. */
  readonly showLabels?: boolean;
  /**
   * Practice mode. Held keys then turn neutral grey instead of blue, because
   * blue means "right hand, play this" whenever guides are on screen.
   */
  readonly guided?: boolean;
  readonly onNoteDown?: (midi: number) => void;
  readonly onNoteUp?: (midi: number) => void;
  /**
   * Drawn directly above the keys, inside the same strip. Anything that has
   * to line up with the keyboard belongs here rather than beside it: on a
   * narrow screen the strip scrolls sideways, and a separate element would
   * stay behind.
   */
  readonly above?: ReactNode;
}

export function PianoKeyboard({
  active,
  guides = [],
  lowest,
  highest,
  fifths = 0,
  accidentals = 'auto',
  showLabels = true,
  guided = false,
  onNoteDown,
  onNoteUp,
  above,
}: PianoKeyboardProps) {
  const layout = useMemo(() => keyboardLayout(lowest, highest), [lowest, highest]);
  const activeSet = useMemo(() => new Set(active), [active]);

  // Nearest guide wins when the same key appears at several distances, so a
  // repeated note reads as "play now" rather than "coming up".
  const guideByMidi = useMemo(() => {
    const map = new Map<number, { distance: number; hand: Hand }>();
    for (const guide of guides) {
      const hand = guide.hand ?? 'right';
      const existing = map.get(guide.midi);
      if (existing === undefined || guide.distance < existing.distance) {
        map.set(guide.midi, { distance: guide.distance, hand });
      } else if (guide.distance === existing.distance && hand !== existing.hand) {
        // The same key asked of each hand at the same moment.
        map.set(guide.midi, { distance: guide.distance, hand: 'both' });
      }
    }
    return map;
  }, [guides]);

  const widthPx = layout.width * WHITE_KEY_PX;

  // Keep the keys you have to play now in view. On a screen narrower than
  // the keyboard — any phone — the strip scrolls sideways, and a guide lit
  // up off the edge of the screen is no guide at all. Only scrolls when the
  // keys are actually out of view, so on a wide screen nothing moves.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nowKeys = useMemo(
    () =>
      [...guideByMidi]
        .filter(([, g]) => g.distance === 0)
        .map(([midi]) => midi)
        .sort((a, b) => a - b)
        .join(','),
    [guideByMidi],
  );
  useEffect(() => {
    const strip = scrollRef.current;
    if (!strip || !nowKeys) return;
    const svg = strip.querySelector('svg');
    if (!svg) return;
    const keys = [...layout.whiteKeys, ...layout.blackKeys].filter((k) =>
      nowKeys.split(',').includes(String(k.midi)),
    );
    if (!keys.length) return;
    const scale = svg.clientWidth / widthPx;
    const left = Math.min(...keys.map((k) => k.x)) * WHITE_KEY_PX * scale;
    const right = Math.max(...keys.map((k) => k.x + k.width)) * WHITE_KEY_PX * scale;
    const margin = 24;
    if (left >= strip.scrollLeft + margin && right <= strip.scrollLeft + strip.clientWidth - margin) {
      return;
    }
    strip.scrollTo({
      left: (left + right) / 2 - strip.clientWidth / 2,
      behavior: 'smooth',
    });
  }, [nowKeys, layout, widthPx]);

  const pointerHandlers = (midi: number) => ({
    onPointerDown: (event: ReactPointerEvent<SVGRectElement>) => {
      // Touch implicitly captures the pointer to the element it started on,
      // which would stop pointerenter firing as you slide across the keys.
      // Releasing it restores glissando. It must be guarded: calling
      // releasePointerCapture for a pointer that holds no capture throws
      // NotFoundError, and the throw happens before the note is ever played.
      const target = event.currentTarget;
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      onNoteDown?.(midi);
    },
    onPointerUp: () => onNoteUp?.(midi),
    onPointerLeave: (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.buttons !== 0) onNoteUp?.(midi);
    },
    onPointerEnter: (event: ReactPointerEvent<SVGRectElement>) => {
      if (event.buttons !== 0) onNoteDown?.(midi);
    },
  });

  const renderKey = (key: KeyRect) => {
    const isActive = activeSet.has(key.midi);
    const guide = guideByMidi.get(key.midi);
    const guideDistance = guide?.distance;
    const x = key.x * WHITE_KEY_PX;
    const width = key.width * WHITE_KEY_PX;
    const height = key.height * KEYBOARD_HEIGHT_PX;
    const spelled = spellNote(key.midi, fifths, accidentals);

    const classes = [
      'key',
      key.black ? 'key--black' : 'key--white',
      isActive ? 'key--active' : '',
      guide !== undefined
        ? `key--guide key--guide-${Math.min(guide.distance, 2)} key--hand-${guide.hand}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const showName = showLabels && (isActive || guideDistance === 0);

    return (
      <g key={key.midi}>
        <rect
          x={x}
          y={0}
          width={width}
          height={height}
          rx={key.black ? 2.5 : 3.5}
          className={classes}
          role="button"
          tabIndex={-1}
          aria-label={noteName(spelled)}
          aria-pressed={isActive}
          data-midi={key.midi}
          data-guide={guideDistance ?? undefined}
          data-hand={guide?.hand}
          {...pointerHandlers(key.midi)}
        />
        {showName && (
          <text
            x={x + width / 2}
            y={height - (key.black ? 10 : 12)}
            className={key.black ? 'key-label key-label--black' : 'key-label'}
          >
            {pitchClassName(spelled)}
          </text>
        )}
        {!key.black && !isActive && guideDistance === undefined && spelled.step === 'C' && (
          <text x={x + width / 2} y={height - 8} className="key-label key-label--octave">
            {`C${spelled.octave}`}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="keyboard-scroll" ref={scrollRef}>
      {above}
      <svg
        className={guided ? 'keyboard keyboard--guided' : 'keyboard'}
        viewBox={`0 0 ${widthPx} ${KEYBOARD_HEIGHT_PX}`}
        width="100%"
        height={KEYBOARD_HEIGHT_PX}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Piano keyboard"
      >
        <defs>
          {/* A unison between the hands: half of each colour, split along the
              key so it reads as two things at once rather than a third
              colour to learn. */}
          <linearGradient id="both-hands" x1="0" y1="0" x2="1" y2="0">
            <stop offset="50%" className="both-hands__right" />
            <stop offset="50%" className="both-hands__left" />
          </linearGradient>
        </defs>
        {/* White keys first, black keys painted over them. */}
        {layout.whiteKeys.map(renderKey)}
        {layout.blackKeys.map(renderKey)}
      </svg>
    </div>
  );
}
