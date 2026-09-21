import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { contentId } from './library.ts';

describe('identifying a score by its contents', () => {
  it('gives the same file the same id however it arrives', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 a score');
    const fromBuffer = await contentId(bytes.buffer.slice(0));
    const fromBlob = await contentId(new Blob([bytes]));
    assert.equal(fromBuffer, fromBlob);
  });

  it('tells different files apart even when they differ by one byte', async () => {
    const a = await contentId(new Blob(['%PDF-1.7 score A']));
    const b = await contentId(new Blob(['%PDF-1.7 score B']));
    assert.notEqual(a, b);
  });

  it('is SHA-256 where the platform provides it', async () => {
    const id = await contentId(new Blob(['abc']));
    // The published SHA-256 test vector for "abc".
    assert.equal(id, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
