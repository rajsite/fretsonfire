// Pyodide runtime bootstrap shared by all pages.
import type { PyodideAPI } from '../pyodide/pyodide';

export type Pyodide = PyodideAPI;

export const PYODIDE_URL = new URL('/pyodide/', location.origin).href;
export const DEFAULT_PACKAGES = ['numpy', 'pillow', 'pygame-ce'];

export interface RuntimeOptions {
  packages?: string[];
  log?: (msg: string, cls?: string) => void;
}

export function hasJspi(): boolean {
  const wasm = WebAssembly as unknown as Record<string, unknown>;
  return typeof wasm.Suspending === 'function' && typeof wasm.promising === 'function';
}

export async function loadRuntime({ packages = DEFAULT_PACKAGES, log = console.log }: RuntimeOptions = {}): Promise<Pyodide> {
  if (!hasJspi()) {
    throw new Error('This browser does not support WebAssembly JavaScript Promise Integration (JSPI).');
  }
  const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_URL + 'pyodide.mjs')) as typeof import('../pyodide/pyodide');
  const pyodide = await loadPyodide({
    indexURL: PYODIDE_URL,
    stdout: (s) => log(s),
    stderr: (s) => log(s, 'error'),
  });
  if (packages.length) {
    await pyodide.loadPackage(packages, { messageCallback: () => {} });
  }
  return pyodide;
}
