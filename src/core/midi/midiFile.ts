/**
 * Reading a standard MIDI file.
 *
 * Written by hand rather than pulled from a library: the format is small,
 * and what practice needs from it is smaller still — when each note starts,
 * how long it lasts, which track and channel it came from, and the tempo and
 * time signature to read it by.
 *
 * Only the events that bear on that are kept. Controllers, pitch bend,
 * program changes and system-exclusive data are skipped over correctly and
 * then dropped: the app has no sound engine, so they would mean nothing.
 *
 * Times come out in ticks, with the file's own resolution alongside, so
 * nothing here has to decide what a "beat" is. That is the next step's job.
 */

export interface MidiFileNote {
  readonly midi: number;
  /** Start, in ticks from the beginning of the file. */
  readonly startTicks: number;
  /** Length in ticks. Always at least 1: a zero-length note is unplayable. */
  readonly durationTicks: number;
  readonly velocity: number;
  /** 0-based index of the track it came from. */
  readonly track: number;
  /** 0–15, as written. Channel 9 is percussion by convention. */
  readonly channel: number;
}

export interface TempoChange {
  readonly ticks: number;
  readonly microsPerQuarter: number;
}

export interface TimeSignature {
  readonly ticks: number;
  readonly beats: number;
  /** 4 for quarter-note beats, 8 for eighths, and so on. */
  readonly beatType: number;
}

export interface MidiFile {
  readonly format: number;
  readonly ticksPerQuarter: number;
  readonly notes: readonly MidiFileNote[];
  readonly tempos: readonly TempoChange[];
  readonly timeSignatures: readonly TimeSignature[];
  /** Sharps positive, flats negative, from a key signature meta event. */
  readonly keyFifths: number | null;
  /** Track names, in order, where the file gives them. */
  readonly trackNames: readonly string[];
  readonly title: string | null;
}

export class MidiFileError extends Error {}

const decoder = new TextDecoder('utf-8', { fatal: false });

class Reader {
  #at = 0;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get offset(): number {
    return this.#at;
  }

  get done(): boolean {
    return this.#at >= this.#bytes.length;
  }

  seek(to: number): void {
    this.#at = to;
  }

  byte(): number {
    if (this.#at >= this.#bytes.length) throw new MidiFileError('The file ends mid-event.');
    return this.#bytes[this.#at++]!;
  }

  bytes_(length: number): Uint8Array {
    const end = this.#at + length;
    if (end > this.#bytes.length) throw new MidiFileError('The file ends mid-event.');
    const slice = this.#bytes.subarray(this.#at, end);
    this.#at = end;
    return slice;
  }

  uint16(): number {
    return (this.byte() << 8) | this.byte();
  }

  uint32(): number {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }

  text(length: number): string {
    return decoder.decode(this.bytes_(length));
  }

  /** The format's own compressed integer: seven bits per byte. */
  variableLength(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.byte();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiFileError('A delta time is longer than the format allows.');
  }
}

interface Pending {
  startTicks: number;
  velocity: number;
}

const ID = (reader: Reader) => reader.text(4);

export function parseMidiFile(data: ArrayBuffer | Uint8Array): MidiFile {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const reader = new Reader(bytes);

  if (bytes.length < 14 || ID(reader) !== 'MThd') {
    throw new MidiFileError('This is not a MIDI file: it does not start with a MThd header.');
  }
  const headerLength = reader.uint32();
  const headerEnd = reader.offset + headerLength;
  const format = reader.uint16();
  const trackCount = reader.uint16();
  const division = reader.uint16();
  if (division & 0x8000) {
    // SMPTE timing states frames per second and ticks per frame instead of
    // ticks per quarter. Nothing that writes piano music uses it, and
    // guessing a tempo from it would be worse than saying so.
    throw new MidiFileError('This MIDI file is timed in SMPTE frames, which is not supported.');
  }
  reader.seek(headerEnd);

  const notes: MidiFileNote[] = [];
  const tempos: TempoChange[] = [];
  const timeSignatures: TimeSignature[] = [];
  const trackNames: string[] = [];
  let keyFifths: number | null = null;
  let title: string | null = null;

  for (let track = 0; track < trackCount && !reader.done; track++) {
    const id = ID(reader);
    const length = reader.uint32();
    const end = reader.offset + length;
    if (id !== 'MTrk') {
      // An unknown chunk is to be skipped, says the spec.
      reader.seek(end);
      continue;
    }

    let ticks = 0;
    let status = 0;
    // Per channel and pitch, the note-on still waiting for its note-off.
    const pending = new Map<number, Pending[]>();

    while (reader.offset < end) {
      ticks += reader.variableLength();
      let byte = reader.byte();
      if (byte < 0x80) {
        // Running status: the event repeats the last status byte and this
        // byte is already its first data byte.
        if (status === 0) throw new MidiFileError('The file uses running status before any status byte.');
        reader.seek(reader.offset - 1);
        byte = status;
      } else if (byte < 0xf0) {
        status = byte;
      }

      if (byte === 0xff) {
        const type = reader.byte();
        const metaLength = reader.variableLength();
        const start = reader.offset;
        if (type === 0x51 && metaLength === 3) {
          tempos.push({
            ticks,
            microsPerQuarter: (reader.byte() << 16) | (reader.byte() << 8) | reader.byte(),
          });
        } else if (type === 0x58 && metaLength >= 2) {
          const beats = reader.byte();
          const power = reader.byte();
          timeSignatures.push({ ticks, beats, beatType: 2 ** power });
        } else if (type === 0x59 && metaLength >= 1) {
          const raw = reader.byte();
          if (keyFifths === null) keyFifths = raw > 127 ? raw - 256 : raw;
        } else if (type === 0x03) {
          const name = reader.text(metaLength).trim();
          trackNames[track] = name;
          if (title === null && name) title = name;
        }
        reader.seek(start + metaLength);
        continue;
      }

      if (byte === 0xf0 || byte === 0xf7) {
        reader.seek(reader.offset + reader.variableLength());
        continue;
      }

      const command = byte & 0xf0;
      const channel = byte & 0x0f;
      if (command === 0x90 || command === 0x80) {
        const midi = reader.byte() & 0x7f;
        const velocity = reader.byte() & 0x7f;
        const key = channel * 128 + midi;
        // A note-on with velocity 0 is how most instruments release a key.
        if (command === 0x90 && velocity > 0) {
          const list = pending.get(key) ?? [];
          list.push({ startTicks: ticks, velocity });
          pending.set(key, list);
        } else {
          const list = pending.get(key);
          const started = list?.shift();
          if (started) {
            notes.push({
              midi,
              startTicks: started.startTicks,
              durationTicks: Math.max(1, ticks - started.startTicks),
              velocity: started.velocity,
              track,
              channel,
            });
          }
        }
      } else if (command === 0xa0 || command === 0xb0 || command === 0xe0) {
        reader.byte();
        reader.byte();
      } else if (command === 0xc0 || command === 0xd0) {
        reader.byte();
      } else {
        throw new MidiFileError(`Unknown MIDI event 0x${byte.toString(16)}.`);
      }
    }

    // A note left hanging at the end of the track still sounded; give it
    // what is left rather than dropping it.
    for (const [key, list] of pending) {
      for (const started of list) {
        notes.push({
          midi: key % 128,
          startTicks: started.startTicks,
          durationTicks: Math.max(1, ticks - started.startTicks),
          velocity: started.velocity,
          track,
          channel: Math.floor(key / 128),
        });
      }
    }

    reader.seek(end);
  }

  notes.sort((a, b) => a.startTicks - b.startTicks || a.midi - b.midi);
  tempos.sort((a, b) => a.ticks - b.ticks);
  timeSignatures.sort((a, b) => a.ticks - b.ticks);

  if (notes.length === 0) {
    throw new MidiFileError('This MIDI file has no notes in it.');
  }

  return {
    format,
    ticksPerQuarter: division,
    notes,
    tempos,
    timeSignatures,
    keyFifths,
    trackNames,
    title,
  };
}

/** Quarter notes per minute at the start of the file, when it says. */
export function startingTempoBpm(file: MidiFile): number | null {
  const first = file.tempos[0];
  if (!first || first.microsPerQuarter <= 0) return null;
  return Math.round(60_000_000 / first.microsPerQuarter);
}
