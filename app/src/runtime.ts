// Shared bootstrap for pages that run game code: runtime, game files, persistence, JS bridge module.
import { loadRuntime, type Pyodide } from './boot.ts';
import { installGameFiles, mountPersistent, setupPythonPath, type GameFs, type InstallOptions } from './fs.ts';
import { nextFrame } from './frame.ts';

export interface GameRuntime {
  pyodide: Pyodide;
  files: GameFs;
  persist: () => Promise<void>;
  bridge: Record<string, unknown>;
}

export interface GameRuntimeOptions extends InstallOptions {
  log?: (msg: string, cls?: string) => void;
  packages?: string[];
  // Extra functions exposed to Python through the `fofjs` module.
  bridge?: Record<string, unknown>;
  // Extra modules registered with pyodide.registerJsModule.
  modules?: Record<string, object>;
}

export async function startGameRuntime(options: GameRuntimeOptions = {}): Promise<GameRuntime> {
  const pyodide = await loadRuntime({ log: options.log, packages: options.packages });
  const files = await installGameFiles(pyodide, options);
  const { persist } = await mountPersistent(pyodide);
  setupPythonPath(pyodide);

  const bridge: Record<string, unknown> = {
    nextFrame,
    persist,
    lazyUrl: (path: string) => files.lazy.get(path) ?? null,
    fetchBytes: async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
    ...options.bridge,
  };
  pyodide.registerJsModule('fofjs', bridge);
  for (const [name, module] of Object.entries(options.modules ?? {})) {
    pyodide.registerJsModule(name, module);
  }
  return { pyodide, files, persist, bridge };
}
