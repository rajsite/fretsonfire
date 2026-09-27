// Launches the full game on a page: start gate, loading progress, main loop, restart and quit.
import { startGameRuntime, type GameRuntime } from './runtime.ts';
import { createPlatform, toggleFullscreen, type Platform } from './platform.ts';
import { hasJspi } from './boot.ts';
import { openSongPack, type SongPack } from './songpack.ts';
import { describePad } from './gamepad.ts';

export interface GameState {
  layers: string[];
  score?: number;
  notesHit?: number;
}

export interface PackInfo {
  name: string;
  songs: number;
  warnings: string[];
}

declare global {
  interface Window {
    __fof?: { state: GameState | null; platform?: Platform; runtime?: GameRuntime; pack?: PackInfo };
  }
}

export interface LaunchOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  log?: (msg: string, cls?: string) => void;
  argv?: string[];
  autostart?: boolean;
}

function showOverlay(overlay: HTMLElement, html: string): void {
  overlay.innerHTML = html;
  overlay.hidden = false;
}

const PACK_KEY = 'fof.songPack';

const START_GATE = `
  <button id="fof-start" class="fof-start">Click to play Frets on Fire</button>
  <div class="fof-pack">
    <label class="fof-pack-pick">Add song pack (.zip)<input id="fof-pack-input" type="file" accept=".zip,application/zip" hidden /></label>
    <span id="fof-pack-status"></span>
    <button id="fof-pack-remove" class="fof-pack-remove" hidden>Remove</button>
  </div>
  <p id="fof-pad-status" class="fof-pad-status"></p>`;

// Browsers only expose a gamepad after one of its buttons is pressed on the page.
function setupPadStatus(overlay: HTMLElement): void {
  const status = overlay.querySelector<HTMLElement>('#fof-pad-status')!;
  const update = () => {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p);
    status.textContent = pads.length
      ? `Guitar connected: ${pads.map(describePad).join(', ')}`
      : 'Playing with a guitar controller? Press one of its buttons to connect it.';
  };
  update();
  addEventListener('gamepadconnected', update);
  addEventListener('gamepaddisconnected', update);
}

// Wires the start gate's song pack picker; returns the pack chosen by the time the game starts.
function setupPackPicker(overlay: HTMLElement): () => Promise<SongPack | undefined> {
  const input = overlay.querySelector<HTMLInputElement>('#fof-pack-input')!;
  const status = overlay.querySelector<HTMLElement>('#fof-pack-status')!;
  const remove = overlay.querySelector<HTMLButtonElement>('#fof-pack-remove')!;
  let current: Promise<SongPack | undefined> = Promise.resolve(undefined);
  let token = 0;
  const show = (text: string, cls = '') => {
    status.textContent = text;
    status.className = cls;
  };
  const remembered = localStorage.getItem(PACK_KEY);
  if (remembered) show(`Select ${remembered} again to use your song pack`, 'fof-pack-hint');

  const choose = (file: File) => {
    const mine = ++token;
    show(`Reading ${file.name}\u2026`);
    remove.hidden = true;
    window.__fof!.pack = undefined;
    current = openSongPack(file).then(
      (pack) => {
        if (mine !== token) return undefined;
        localStorage.setItem(PACK_KEY, file.name);
        const { songs, warnings } = pack.layout;
        for (const w of warnings) console.warn(`song pack: ${w}`);
        show(`${pack.name}: ${songs.length} songs${warnings.length ? `, ${warnings.length} files skipped` : ''}`, 'fof-pack-ok');
        remove.hidden = false;
        window.__fof!.pack = { name: pack.name, songs: songs.length, warnings };
        return pack;
      },
      (e: unknown) => {
        if (mine === token) show(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'fof-pack-error');
        return undefined;
      },
    );
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) choose(file);
  });
  overlay.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  overlay.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    choose(file);
  });
  remove.addEventListener('click', () => {
    token++;
    current = Promise.resolve(undefined);
    localStorage.removeItem(PACK_KEY);
    window.__fof!.pack = undefined;
    show('');
    remove.hidden = true;
  });
  return () => current;
}

export function launchGame(options: LaunchOptions): Promise<'quit' | 'restart'> {
  const { container, canvas, overlay } = options;
  window.__fof = { state: null };

  if (!hasJspi()) {
    showOverlay(overlay, '<h2>Unsupported browser</h2><p>This game needs WebAssembly JavaScript Promise Integration (JSPI), available in current Chromium-based browsers.</p>');
    return Promise.reject(new Error('JSPI not supported'));
  }

  return new Promise((resolve, reject) => {
    let chosenPack: () => Promise<SongPack | undefined> = () => Promise.resolve(undefined);
    const start = async () => {
      // The AudioContext must be created and resumed within the user gesture.
      const audioContext = new AudioContext({ latencyHint: 'interactive' });
      void audioContext.resume();
      const songPack = await chosenPack();
      showOverlay(overlay, '<h2>Loading&hellip;</h2><p id="fof-progress"></p>');
      try {
        const platform = createPlatform(canvas, container, audioContext);
        window.__fof!.platform = platform;
        const rt = await startGameRuntime({
          log: options.log,
          modules: platform.modules,
          songPack,
          onProgress: (loaded, total) => {
            const p = document.getElementById('fof-progress');
            if (p) p.textContent = `${Math.round((100 * loaded) / total)}%`;
          },
          bridge: {
            setVideoMode: (width: number, height: number) => {
              canvas.style.aspectRatio = `${width} / ${height}`;
            },
            toggleFullscreen: () => toggleFullscreen(container),
            setState: (json: string) => {
              window.__fof!.state = JSON.parse(json) as GameState;
            },
          },
        });
        window.__fof!.runtime = rt;
        overlay.hidden = true;
        canvas.focus();
        const argv = JSON.stringify(options.argv ?? []);
        const outcome = (await rt.pyodide.runPythonAsync(`import fof_web.main as m; m.run(${argv})`)) as 'quit' | 'restart';
        await rt.persist();
        if (outcome === 'restart') {
          location.reload();
        } else {
          showOverlay(overlay, '<h2>Thanks for playing!</h2><button id="fof-again">Play again</button>');
          document.getElementById('fof-again')!.addEventListener('click', () => location.reload());
        }
        resolve(outcome);
      } catch (e) {
        showOverlay(overlay, `<h2>Something went wrong</h2><pre>${String(e instanceof Error ? e.message : e).replace(/</g, '&lt;')}</pre>`);
        reject(e);
      }
    };

    if (options.autostart) {
      void start();
    } else {
      showOverlay(overlay, START_GATE);
      chosenPack = setupPackPicker(overlay);
      setupPadStatus(overlay);
      document.getElementById('fof-start')!.addEventListener('click', () => void start(), { once: true });
    }
  });
}
