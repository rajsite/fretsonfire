// Game file system: manifest-driven fetch into MEMFS, lazy stubs, IDBFS persistence.
import type { Pyodide } from './boot.ts';

// MEMFS location of the game files.
export const GAME_ROOT = '/game';
// URL the game files are served from (the app may be hosted under a sub-path).
export const GAME_URL = `${import.meta.env.BASE_URL}game`;
export const WRITABLE_DIR = '/home/pyodide/.fretsonfire';

export interface ManifestEntry {
  path: string;
  size: number;
  class: 'core' | 'lazy';
}

export interface InstallOptions {
  include?: (path: string) => boolean;
  onProgress?: (loaded: number, total: number) => void;
  concurrency?: number;
}

export interface GameFs {
  // MEMFS path -> source for files that exist only as zero-length stubs.
  lazy: Map<string, LazySource>;
  fetched: number;
  bytes: number;
}

// Contents of a lazy file, fetched on demand.
export interface LazySource {
  // A URL or a zip entry description, for diagnostics.
  readonly origin: string;
  bytes(): Promise<Uint8Array>;
  blob(): Promise<Blob>;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function urlSource(url: string): LazySource {
  return {
    origin: url,
    bytes: () => fetchBytes(url),
    blob: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.blob();
    },
  };
}

export async function installGameFiles(pyodide: Pyodide, options: InstallOptions = {}): Promise<GameFs> {
  const { include = () => true, onProgress, concurrency = 16 } = options;
  const FS = pyodide.FS;
  const manifest: { files: ManifestEntry[] } = await (await fetch(`${GAME_URL}/manifest.json`)).json();
  const entries = manifest.files.filter((f) => include(f.path));
  const result: GameFs = { lazy: new Map(), fetched: 0, bytes: 0 };

  const core: ManifestEntry[] = [];
  for (const entry of entries) {
    const fsPath = `${GAME_ROOT}/${entry.path}`;
    FS.mkdirTree(fsPath.slice(0, fsPath.lastIndexOf('/')));
    if (entry.class === 'lazy') {
      FS.writeFile(fsPath, new Uint8Array(0));
      result.lazy.set(fsPath, urlSource(`${GAME_URL}/${entry.path}`));
    } else {
      core.push(entry);
    }
  }

  const total = core.reduce((n, e) => n + e.size, 0);
  let next = 0;
  const worker = async () => {
    while (next < core.length) {
      const entry = core[next++];
      const data = await fetchBytes(`${GAME_URL}/${entry.path}`);
      FS.writeFile(`${GAME_ROOT}/${entry.path}`, data);
      result.fetched++;
      result.bytes += data.length;
      onProgress?.(result.bytes, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, core.length) }, worker));
  return result;
}

function syncfs(pyodide: Pyodide, populate: boolean): Promise<void> {
  return new Promise((resolve, reject) => pyodide.FS.syncfs(populate, (err: unknown) => (err ? reject(err) : resolve())));
}

export interface Persistence {
  persist: () => Promise<void>;
}

// Mounts IDBFS on the game's writable directory and restores its contents.
export async function mountPersistent(pyodide: Pyodide, dir = WRITABLE_DIR): Promise<Persistence> {
  const FS = pyodide.FS;
  FS.mkdirTree(dir);
  FS.mount(FS.filesystems.IDBFS, {}, dir);
  await syncfs(pyodide, true);

  let running: Promise<void> | null = null;
  let pending = false;
  const persist = async (): Promise<void> => {
    if (running) {
      pending = true;
      return running;
    }
    running = syncfs(pyodide, false).finally(() => {
      running = null;
      if (pending) {
        pending = false;
        void persist();
      }
    });
    return running;
  };
  addEventListener('pagehide', () => void persist());
  return { persist };
}

export function setupPythonPath(pyodide: Pyodide): void {
  pyodide.FS.mkdirTree(`${GAME_ROOT}/src`);
  pyodide.FS.mkdirTree(`${GAME_ROOT}/app-python`);
  pyodide.runPython(`
import os, sys
os.chdir("${GAME_ROOT}/src")
for p in ("${GAME_ROOT}/src", "${GAME_ROOT}/app-python"):
    if p not in sys.path:
        sys.path.insert(0, p)
`);
}
