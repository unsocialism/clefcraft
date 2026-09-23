/**
 * The small parts of a standard MIDI file that everything writing one needs.
 *
 * Kept apart from the things that use them — the PDF export and the free-play
 * recorder — because they are format plumbing, not decisions about music.
 */

/** Ticks in a quarter note, in everything this app writes. */
export const TICKS_PER_QUARTER = 480;

/** The format's own compressed integer: seven bits per byte. */
export function variableLength(value: number): number[] {
  const bytes = [Math.max(0, Math.round(value)) & 0x7f];
  let rest = Math.max(0, Math.round(value)) >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

export function chunk(id: string, body: readonly number[]): number[] {
  const length = body.length;
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    ...body,
  ];
}

/** A meta text event at delta 0: 0x03 is a track name, 0x01 a comment. */
export function textEvent(type: number, text: string): number[] {
  const bytes = [...text].map((c) => c.charCodeAt(0) & 0x7f);
  return [0x00, 0xff, type, ...variableLength(bytes.length), ...bytes];
}

export function header(tracks: number, ticksPerQuarter = TICKS_PER_QUARTER): number[] {
  return chunk('MThd', [
    0x00,
    0x01, // format 1: several tracks, played together
    (tracks >> 8) & 0xff,
    tracks & 0xff,
    (ticksPerQuarter >> 8) & 0xff,
    ticksPerQuarter & 0xff,
  ]);
}

/** The track that carries the tempo and nothing to play. */
export function conductorTrack(options: {
  title: string;
  comment?: string;
  tempoBpm: number;
}): number[] {
  const microsPerQuarter = Math.round(60_000_000 / Math.max(1, options.tempoBpm));
  return chunk('MTrk', [
    ...textEvent(0x03, options.title),
    ...(options.comment ? textEvent(0x01, options.comment) : []),
    0x00,
    0xff,
    0x51,
    0x03,
    (microsPerQuarter >> 16) & 0xff,
    (microsPerQuarter >> 8) & 0xff,
    microsPerQuarter & 0xff,
    0x00,
    0xff,
    0x2f,
    0x00,
  ]);
}

export interface NoteEvent {
  readonly tick: number;
  readonly on: boolean;
  readonly midi: number;
  readonly velocity: number;
}

/**
 * A track of note events, sorted and written as deltas.
 *
 * Note-offs come before note-ons at the same tick, so a repeated note is
 * released before it is struck again rather than cut short by its own
 * note-off.
 */
export function noteTrack(
  events: readonly NoteEvent[],
  options: { name: string; channel: number },
): number[] {
  const sorted = [...events].sort(
    (a, b) => a.tick - b.tick || Number(a.on) - Number(b.on) || a.midi - b.midi,
  );
  const body: number[] = [...textEvent(0x03, options.name)];
  let last = 0;
  for (const event of sorted) {
    body.push(...variableLength(event.tick - last));
    body.push(
      (event.on ? 0x90 : 0x80) | (options.channel & 0x0f),
      event.midi & 0x7f,
      event.on ? Math.min(127, Math.max(1, Math.round(event.velocity))) : 0,
    );
    last = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return chunk('MTrk', body);
}
