import type { MidiEvent } from './types.ts';

export const SUSTAIN_CC = 64;
const CC_ALL_NOTES_OFF = 123;
const CC_ALL_SOUND_OFF = 120;

/**
 * Decode one MIDI channel-voice message.
 *
 * Returns `null` for anything we do not act on (aftertouch, program change,
 * clock, sysex, other CCs) so callers can ignore it without a type switch.
 *
 * Two details that trip people up and that the tests pin down:
 *  - A note-on with velocity 0 is a note-off. Most keyboards send this.
 *  - Sustain (CC64) is "down" at value >= 64. Half-pedalling is rounded to
 *    the binary reading, which is what a plain note display wants.
 */
export function parseMidiMessage(data: ArrayLike<number>, time = 0): MidiEvent | null {
  if (data.length < 1) return null;

  const status = data[0] ?? 0;
  // Running status / realtime bytes: we only handle complete channel messages.
  if (status < 0x80) return null;
  if (status >= 0xf0) return null;

  const kind = status & 0xf0;
  const channel = status & 0x0f;

  switch (kind) {
    case 0x90: {
      if (data.length < 3) return null;
      const note = data[1] ?? 0;
      const velocity = data[2] ?? 0;
      if (velocity === 0) return { type: 'noteoff', note, velocity: 0, channel, time };
      return { type: 'noteon', note, velocity, channel, time };
    }
    case 0x80: {
      if (data.length < 3) return null;
      return { type: 'noteoff', note: data[1] ?? 0, velocity: data[2] ?? 0, channel, time };
    }
    case 0xb0: {
      if (data.length < 3) return null;
      const controller = data[1] ?? 0;
      const value = data[2] ?? 0;
      if (controller === SUSTAIN_CC) {
        return { type: 'sustain', down: value >= 64, channel, time };
      }
      if (controller === CC_ALL_NOTES_OFF || controller === CC_ALL_SOUND_OFF) {
        return { type: 'allnotesoff', channel, time };
      }
      return null;
    }
    default:
      return null;
  }
}
