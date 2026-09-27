// Song packs: a user-selected zip of songs mounted as a library under /game/data/songs/<pack>.
import type { LazySource } from './fs.ts';
import { openZip, readEntry, entryBlob, type ZipArchive, type ZipEntry, type ZipSource } from './zip.ts';

// GAME_ROOT/data/songs; fs.ts is not imported so this module also loads outside Vite (tests).
export const SONGS_DIR = '/game/data/songs';

// Files the game reads while listing songs; everything else is read from the zip on demand.
const EAGER_FILES = new Set(['song.ini', 'notes.mid', 'script.txt']);
const LAZY_FILES = new Set(['song.ogg', 'guitar.ogg', 'rhythm.ogg', 'drums.ogg', 'label.png']);
const MAX_EAGER_SIZE = 16 << 20;
const MIME: Record<string, string> = { '.ogg': 'audio/ogg', '.png': 'image/png' };

export interface PackFile {
  // Path relative to the pack root, with normalized file names.
  path: string;
  entry: ZipEntry;
  eager: boolean;
}

export interface PackLayout {
  songs: string[];
  files: PackFile[];
  // Folders that get a synthesized library.ini so the game can walk down to their songs.
  libraries: string[];
  warnings: string[];
}

export interface SongPack {
  name: string;
  archive: ZipArchive;
  layout: PackLayout;
}

export class SongPackError extends Error {
  override name = 'SongPackError';
}

// Splits an entry name into safe path segments, or null for names that could escape the pack.
export function safeSegments(name: string): string[] | null {
  if (name.includes('\0')) return null;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
  const segments = normalized.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) return null;
  return segments;
}

export function packName(fileName: string): string {
  const base = fileName.replace(/\.zip$/i, '').replace(/[/\\\0]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base : 'Song pack';
}

export function layoutPack(entries: ZipEntry[]): PackLayout {
  const warnings: string[] = [];
  const files: { segments: string[]; entry: ZipEntry }[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const segments = safeSegments(entry.name);
    if (!segments) {
      warnings.push(`${entry.name}: unsafe path, skipped`);
      continue;
    }
    // macOS resource forks.
    if (segments[0] === '__MACOSX' || segments[segments.length - 1].startsWith('._')) continue;
    if (segments.length) files.push({ segments, entry });
  }

  const top = files[0]?.segments[0];
  const wrapped =
    top !== undefined &&
    files.every((f) => f.segments.length > 1 && f.segments[0] === top) &&
    !files.some((f) => f.segments.length === 2 && f.segments[1].toLowerCase() === 'song.ini');
  if (wrapped) {
    for (const f of files) f.segments = f.segments.slice(1);
  }

  const byDir = new Map<string, { segments: string[]; entry: ZipEntry }[]>();
  for (const f of files) {
    const dir = f.segments.slice(0, -1).join('/');
    let list = byDir.get(dir);
    if (!list) byDir.set(dir, (list = []));
    list.push(f);
  }

  const usable = (e: ZipEntry) => (e.flags & 1) === 0 && (e.method === 0 || e.method === 8);
  const out: PackFile[] = [];
  const songs: string[] = [];
  for (const [dir, list] of byDir) {
    const named = new Map<string, ZipEntry>();
    for (const { segments, entry } of list) {
      const lower = segments[segments.length - 1].toLowerCase();
      if (!named.has(lower)) named.set(lower, entry);
    }
    if (!dir || !named.has('song.ini')) continue;
    if (!named.has('label.png') && named.has('album.png')) named.set('label.png', named.get('album.png')!);

    const picked: PackFile[] = [];
    for (const [lower, entry] of named) {
      const eager = EAGER_FILES.has(lower);
      if (!eager && !LAZY_FILES.has(lower)) continue;
      if (!usable(entry)) {
        warnings.push(`${entry.name}: encrypted or unsupported compression, skipped`);
        continue;
      }
      if (eager && entry.size > MAX_EAGER_SIZE) {
        warnings.push(`${entry.name}: too large, skipped`);
        continue;
      }
      picked.push({ path: `${dir}/${lower}`, entry, eager });
    }
    if (!picked.some((f) => f.path.endsWith('/song.ini'))) continue;
    songs.push(dir);
    out.push(...picked);
  }
  songs.sort();

  const rootLabel = byDir.get('')?.find((f) => f.segments[0].toLowerCase() === 'label.png');
  if (rootLabel && usable(rootLabel.entry)) out.push({ path: 'label.png', entry: rootLabel.entry, eager: false });

  const songSet = new Set(songs);
  const parentsWithSongs = new Set(songs.map((s) => s.split('/').slice(0, -1).join('/')));
  const libraries = new Set<string>();
  for (const song of songs) {
    const parts = song.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!songSet.has(dir) && !parentsWithSongs.has(dir)) libraries.add(dir);
    }
  }
  return { songs, files: out, libraries: [...libraries].sort(), warnings };
}

export async function openSongPack(file: ZipSource & { name: string }): Promise<SongPack> {
  const archive = await openZip(file);
  const layout = layoutPack(archive.entries);
  if (!layout.songs.length) throw new SongPackError(`${file.name} has no songs (no folders with a song.ini)`);
  return { name: packName(file.name), archive, layout };
}

function zipSource(archive: ZipArchive, entry: ZipEntry, type: string): LazySource {
  return {
    origin: `zip:${entry.name}`,
    bytes: () => readEntry(archive, entry),
    blob: () => entryBlob(archive, entry, type),
  };
}

interface MountFS {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array | string): void;
  analyzePath(path: string): { exists: boolean };
}

// Writes the pack's small files into MEMFS and registers the rest as lazy stubs.
export async function mountSongPack(FS: MountFS, pack: SongPack, lazy: Map<string, LazySource>, concurrency = 8): Promise<string> {
  let name = pack.name;
  while (FS.analyzePath(`${SONGS_DIR}/${name}`).exists) name += '_';
  const root = `${SONGS_DIR}/${name}`;
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
  FS.mkdirTree(root);
  for (const lib of pack.layout.libraries) {
    const dir = lib ? `${root}/${lib}` : root;
    FS.mkdirTree(dir);
    FS.writeFile(`${dir}/library.ini`, '');
  }
  const eager: PackFile[] = [];
  for (const f of pack.layout.files) {
    const path = `${root}/${f.path}`;
    FS.mkdirTree(dirOf(path));
    if (f.eager) {
      eager.push(f);
    } else {
      FS.writeFile(path, new Uint8Array(0));
      lazy.set(path, zipSource(pack.archive, f.entry, MIME[f.path.slice(f.path.lastIndexOf('.'))] ?? ''));
    }
  }
  let next = 0;
  const worker = async () => {
    while (next < eager.length) {
      const f = eager[next++];
      FS.writeFile(`${root}/${f.path}`, await readEntry(pack.archive, f.entry, MAX_EAGER_SIZE));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, eager.length) }, worker));
  return root;
}
