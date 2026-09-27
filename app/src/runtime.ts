// Shared bootstrap for pages that run game code: runtime, game files, persistence, JS bridge module.
import { loadRuntime, type Pyodide } from './boot.ts';
import { installGameFiles, mountPersistent, setupPythonPath, type GameFs, type InstallOptions } from './fs.ts';
import { mountSongPack, type SongPack } from './songpack.ts';
import { nextFrame } from './frame.ts';

export interface GameRuntime {
  pyodide: Pyodide;
  files: GameFs;
  persist: () => Promise<void>;
  bridge: Record<string, unknown>;
  // MEMFS folder of the mounted song pack.
  songPackRoot?: string;
}

export interface GameRuntimeOptions extends InstallOptions {
  log?: (msg: string, cls?: string) => void;
  packages?: string[];
  songPack?: SongPack;
  // Extra functions exposed to Python through the `fofjs` module.
  bridge?: Record<string, unknown>;
  // Extra modules registered with pyodide.registerJsModule.
  modules?: Record<string, object> | ((rt: Omit<GameRuntime, 'bridge'>) => Record<string, object>);
}

export async function startGameRuntime(options: GameRuntimeOptions = {}): Promise<GameRuntime> {
  const pyodide = await loadRuntime({ log: options.log, packages: options.packages });
  const files = await installGameFiles(pyodide, options);
  const songPackRoot = options.songPack ? await mountSongPack(pyodide.FS, options.songPack, files.lazy) : undefined;
  const { persist } = await mountPersistent(pyodide);
  setupPythonPath(pyodide);

  const lazy = (path: string) => {
    const source = files.lazy.get(path);
    if (!source) throw new Error(`${path} is not a lazy file`);
    return source;
  };
  const bridge: Record<string, unknown> = {
    nextFrame,
    persist,
    lazyOrigin: (path: string) => files.lazy.get(path)?.origin ?? null,
    readLazy: (path: string) => lazy(path).bytes(),
    ...options.bridge,
  };
  pyodide.registerJsModule('fofjs', bridge);
  const modules = typeof options.modules === 'function' ? options.modules({ pyodide, files, persist }) : options.modules;
  for (const [name, module] of Object.entries(modules ?? {})) {
    pyodide.registerJsModule(name, module);
  }
  return { pyodide, files, persist, bridge, songPackRoot };
}
