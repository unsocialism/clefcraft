import { useCallback, useRef, useState } from 'react';

export type LoadedFileKind = 'musicxml' | 'pdf';

export interface LoadedFile {
  readonly kind: LoadedFileKind;
  readonly name: string;
  /**
   * MusicXML as text, a Blob for a compressed .mxl, or an ArrayBuffer for a
   * PDF. OSMD's load() takes `string | Document | Blob` — handing it a
   * Uint8Array for an .mxl does not work, which is why the zip case stays a
   * Blob all the way through.
   */
  readonly content: string | Blob | ArrayBuffer;
}

export interface ScoreLoaderProps {
  onLoad(file: LoadedFile): void;
  onError(message: string): void;
  readonly currentName: string | null;
}

const MUSICXML_EXTENSIONS = ['.musicxml', '.xml', '.mxl'];

function kindOf(name: string): LoadedFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (MUSICXML_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'musicxml';
  return null;
}

export function ScoreLoader({ onLoad, onError, currentName }: ScoreLoaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const read = useCallback(
    async (file: File) => {
      const kind = kindOf(file.name);
      if (!kind) {
        onError(`${file.name} is not a score. Load a .musicxml, .xml, .mxl or .pdf file.`);
        return;
      }
      try {
        if (kind === 'pdf') {
          onLoad({ kind, name: file.name, content: await file.arrayBuffer() });
          return;
        }
        // .mxl is a zip container: OSMD unzips a Blob itself, so the File is
        // passed straight through. Plain MusicXML is read as text.
        if (file.name.toLowerCase().endsWith('.mxl')) {
          onLoad({ kind, name: file.name, content: file });
        } else {
          onLoad({ kind, name: file.name, content: await file.text() });
        }
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [onLoad, onError],
  );

  return (
    <div
      className={dragging ? 'loader loader--dragging' : 'loader'}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void read(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".musicxml,.xml,.mxl,.pdf"
        className="loader__input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = '';
        }}
      />
      <button type="button" className="button button--primary" onClick={() => inputRef.current?.click()}>
        Open score
      </button>
      <span className="loader__hint">
        {currentName ?? 'Drop a MusicXML (.musicxml, .mxl) or PDF here'}
      </span>
    </div>
  );
}
