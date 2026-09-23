/**
 * Scores kept on the device, so a piece you have opened once is there the
 * next time — on a phone, without going back to wherever the file came from.
 *
 * Stored in IndexedDB, which every browser has and which holds binary data
 * directly. Everything stays on the device; nothing is uploaded anywhere.
 *
 * A score is identified by a hash of its contents rather than its file
 * name. Opening the same PDF twice — or the same file under a different
 * name — finds the existing entry and its corrections instead of making a
 * second copy with none.
 */

import type { NoteEdits } from '../pdf/edits.ts';

export type ScoreKind = 'pdf' | 'musicxml' | 'midi';

/** What the library list shows. The file itself is fetched separately. */
export interface ScoreEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: ScoreKind;
  readonly size: number;
  readonly addedAt: number;
  readonly openedAt: number;
}

interface StoredScore extends ScoreEntry {
  readonly data: Blob;
}

// The storage name predates the rename to clefcraft and stays as it is on
// purpose. It is invisible to you, but it is what the browser files your
// saved scores under: change it and every score and correction already kept
// on a device would silently disappear from the list.
const DB_NAME = 'piano-notes';
const DB_VERSION = 1;
const SCORES = 'scores';
const EDITS = 'edits';

export interface Library {
  /** Most recently opened first. */
  list(): Promise<ScoreEntry[]>;
  /** The file, or null if it has been removed. */
  load(id: string): Promise<{ entry: ScoreEntry; data: Blob } | null>;
  /**
   * Keep a file. Returns the existing entry, with a fresh name and open
   * time, when the same contents are already stored.
   */
  save(file: { name: string; kind: ScoreKind; data: Blob }): Promise<ScoreEntry>;
  remove(id: string): Promise<void>;
  /** Record that a score was just opened, for ordering the list. */
  touch(id: string): Promise<void>;
  loadEdits(id: string): Promise<NoteEdits | null>;
  saveEdits(id: string, edits: NoteEdits): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * A content hash, as hex. SHA-256 where the browser offers it; it only
 * does on a secure origin (https or localhost), so a page reached over a
 * plain-http LAN address falls back to FNV-1a — weaker, but only ever used
 * to tell your own files apart, never for security.
 */
export async function contentId(data: Blob | ArrayBuffer): Promise<string> {
  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv-${bytes.length.toString(16)}-${hash.toString(16).padStart(8, '0')}`;
}

function entryOf(stored: StoredScore): ScoreEntry {
  const { data: _data, ...entry } = stored;
  return entry;
}

export async function openLibrary(factory: IDBFactory = globalThis.indexedDB): Promise<Library> {
  if (!factory) throw new Error('This browser has no IndexedDB, so scores cannot be kept.');

  const open = factory.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(SCORES)) db.createObjectStore(SCORES, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(EDITS)) db.createObjectStore(EDITS);
  };
  const db = await request(open);

  // Ask the browser not to evict the library when space runs low. Android
  // Chrome grants this to an installed app; elsewhere it may be declined,
  // which only means the data is kept on the usual best-effort terms.
  void globalThis.navigator?.storage?.persist?.().catch(() => undefined);

  const store = (name: string, mode: IDBTransactionMode) => {
    const tx = db.transaction(name, mode);
    return { tx, os: tx.objectStore(name) };
  };

  return {
    async list() {
      const { os } = store(SCORES, 'readonly');
      const all = (await request(os.getAll())) as StoredScore[];
      return all.map(entryOf).sort((a, b) => b.openedAt - a.openedAt);
    },

    async load(id) {
      const { os } = store(SCORES, 'readonly');
      const stored = (await request(os.get(id))) as StoredScore | undefined;
      return stored ? { entry: entryOf(stored), data: stored.data } : null;
    },

    async save({ name, kind, data }) {
      const id = await contentId(data);
      const now = Date.now();
      const { tx, os } = store(SCORES, 'readwrite');
      const existing = (await request(os.get(id))) as StoredScore | undefined;
      const stored: StoredScore = existing
        ? { ...existing, name, openedAt: now }
        : { id, name, kind, size: data.size, addedAt: now, openedAt: now, data };
      os.put(stored);
      await done(tx);
      return entryOf(stored);
    },

    async remove(id) {
      const tx = db.transaction([SCORES, EDITS], 'readwrite');
      tx.objectStore(SCORES).delete(id);
      // A score's corrections go with it; they mean nothing on their own.
      tx.objectStore(EDITS).delete(id);
      await done(tx);
    },

    async touch(id) {
      const { tx, os } = store(SCORES, 'readwrite');
      const stored = (await request(os.get(id))) as StoredScore | undefined;
      if (stored) os.put({ ...stored, openedAt: Date.now() });
      await done(tx);
    },

    async loadEdits(id) {
      const { os } = store(EDITS, 'readonly');
      const edits = (await request(os.get(id))) as NoteEdits | undefined;
      return edits && edits.version === 1 ? edits : null;
    },

    async saveEdits(id, edits) {
      const { tx, os } = store(EDITS, 'readwrite');
      os.put(edits, id);
      await done(tx);
    },
  };
}
