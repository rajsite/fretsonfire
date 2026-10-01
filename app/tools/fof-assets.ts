// Vite plugin: serves the Pyodide distribution, the game sources/data and the
// browser Python layer, generates the asset manifest and copies a trimmed file
// set into the build output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { compilePo } from './msgfmt.ts';

export type AssetClass = 'core' | 'lazy';

export interface ManifestEntry {
  path: string;
  size: number;
  class: AssetClass;
}

export interface Manifest {
  files: ManifestEntry[];
}

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..');

const MOUNTS: [string, string][] = [
  ['/pyodide/', path.join(APP, 'pyodide')],
  ['/game/src/', path.join(ROOT, 'src')],
  ['/game/data/', path.join(ROOT, 'data')],
  ['/game/app-python/', path.join(APP, 'python')],
];

const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const PYODIDE_PACKAGES = ['numpy', 'pillow', 'pygame-ce'];

const MIME: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.py': 'text/x-python',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.ini': 'text/plain',
  '.txt': 'text/plain',
};

const EXCLUDED_DATA_EXT = new Set(['.svg', '.3ds', '.pyc', '.py', '.sh', '.ico', '.icns', '.po', '.nsi', '.dll', '.exe', '.bmp']);

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__') walk(full, base, out);
    } else {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

// Returns the asset class for a manifest-relative path, or null when excluded.
export function classify(rel: string): AssetClass | null {
  const ext = path.extname(rel).toLowerCase();
  if (rel.startsWith('src/') || rel.startsWith('app-python/')) {
    return ext === '.py' ? 'core' : null;
  }
  if (!rel.startsWith('data/')) return null;
  const sub = rel.slice('data/'.length);
  if (sub.startsWith('win32/') || sub === 'Makefile') return null;
  if (EXCLUDED_DATA_EXT.has(ext)) return null;
  // Song license/link notes ship for attribution but the game never reads them.
  if (sub.startsWith('songs/') && (ext === '.ogg' || ext === '.md')) return 'lazy';
  return 'core';
}

function sourceFor(rel: string): string | null {
  for (const [prefix, dir] of MOUNTS.slice(1)) {
    const p = prefix.slice('/game/'.length);
    if (rel.startsWith(p)) return path.join(dir, rel.slice(p.length));
  }
  return null;
}

// Mirrors data/translations/update.py: <language>.mo = msgcat fretsonfire_<id>.po tutorial_<id>.po
const TRANSLATIONS: Record<string, string> = {
  fr: 'french',
  ger: 'german',
  po: 'polish',
  rus: 'russian',
  sw: 'swedish',
  por: 'brazilian_portuguese',
  he: 'hebrew',
  es: 'spanish',
  it: 'italian',
  gl: 'galician',
  cz: 'czech',
  fi: 'finnish',
  hu: 'hungarian',
  nl: 'dutch',
  cs: 'czech',
  tur: 'turkish',
  hr: 'croatian',
  eo: 'esperanto',
  ltz: 'luxembourgish',
};

function translationSources(): Map<string, string[]> {
  const dir = path.join(ROOT, 'data', 'translations');
  const byLanguage = new Map<string, string[]>();
  for (const [id, language] of Object.entries(TRANSLATIONS)) {
    const files = ['fretsonfire', 'tutorial']
      .map((f) => path.join(dir, `${f}_${id}.po`))
      .filter((f) => fs.existsSync(f));
    if (files.length) byLanguage.set(`data/translations/${language}.mo`, files);
  }
  return byLanguage;
}

function moFiles(): string[] {
  return [...translationSources().keys()];
}

// Translations are compiled from .po on demand, so .mo files are virtual.
function readGameFile(rel: string): Buffer | null {
  if (rel.startsWith('data/translations/') && rel.endsWith('.mo')) {
    const sources = translationSources().get(rel);
    return sources ? compilePo(...sources.map((f) => fs.readFileSync(f))) : null;
  }
  const src = sourceFor(rel);
  return src && fs.existsSync(src) ? fs.readFileSync(src) : null;
}

export function buildManifest(): Manifest {
  const files: ManifestEntry[] = [];
  const add = (prefix: string, dir: string) => {
    for (const rel of walk(dir)) {
      const full = prefix + rel;
      const cls = classify(full);
      if (cls) files.push({ path: full, size: fs.statSync(path.join(dir, rel)).size, class: cls });
    }
  };
  add('src/', path.join(ROOT, 'src'));
  add('data/', path.join(ROOT, 'data'));
  if (fs.existsSync(path.join(APP, 'python'))) add('app-python/', path.join(APP, 'python'));
  for (const mo of moFiles()) {
    files.push({ path: mo, size: readGameFile(mo)?.length ?? 0, class: 'core' });
  }
  return { files };
}

function resolveMounted(urlPath: string): string | null {
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const full = path.resolve(dir, '.' + urlPath.slice(prefix.length - 1));
    return full === dir || full.startsWith(dir + path.sep) ? full : null;
  }
  return null;
}

function send(res: ServerResponse, body: Buffer | string, ext: string) {
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(body);
}

export default function fofAssets(): Plugin {
  let outDir = '';
  return {
    name: 'fof-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        if (urlPath === '/game/manifest.json') {
          return send(res, JSON.stringify(buildManifest()), '.json');
        }
        if (urlPath.startsWith('/game/data/translations/') && urlPath.endsWith('.mo')) {
          const body = readGameFile(urlPath.slice('/game/'.length));
          if (body) return send(res, body, '.mo');
        }
        const file = resolveMounted(urlPath);
        if (!file) return next();
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end('Not found');
        }
        send(res, fs.readFileSync(file), path.extname(file).toLowerCase());
      });
    },
    closeBundle() {
      if (!outDir || !fs.existsSync(outDir)) return;
      const pyodideSrc = path.join(APP, 'pyodide');
      const pyodideOut = path.join(outDir, 'pyodide');
      fs.mkdirSync(pyodideOut, { recursive: true });
      const lock = JSON.parse(fs.readFileSync(path.join(pyodideSrc, 'pyodide-lock.json'), 'utf8'));
      const wheels: string[] = PYODIDE_PACKAGES.map((name) => lock.packages[name].file_name);
      for (const f of [...PYODIDE_FILES, ...wheels]) {
        fs.copyFileSync(path.join(pyodideSrc, f), path.join(pyodideOut, f));
      }
      const manifest = buildManifest();
      for (const { path: rel } of manifest.files) {
        const body = readGameFile(rel);
        if (!body) continue;
        const dest = path.join(outDir, 'game', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, body);
      }
      fs.writeFileSync(path.join(outDir, 'game', 'manifest.json'), JSON.stringify(manifest));
    },
  };
}
