// Launches the full game on a page: start gate, loading progress, main loop, restart and quit.
import { startGameRuntime, type GameRuntime } from './runtime.ts';
import { createPlatform, toggleFullscreen, type Platform } from './platform.ts';
import { hasJspi } from './boot.ts';

export interface GameState {
  layers: string[];
}

declare global {
  interface Window {
    __fof?: { state: GameState | null; platform?: Platform; runtime?: GameRuntime };
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

export function launchGame(options: LaunchOptions): Promise<'quit' | 'restart'> {
  const { container, canvas, overlay } = options;
  window.__fof = { state: null };

  if (!hasJspi()) {
    showOverlay(overlay, '<h2>Unsupported browser</h2><p>This game needs WebAssembly JavaScript Promise Integration (JSPI), available in current Chromium-based browsers.</p>');
    return Promise.reject(new Error('JSPI not supported'));
  }

  return new Promise((resolve, reject) => {
    const start = async () => {
      // The AudioContext must be created and resumed within the user gesture.
      const audioContext = new AudioContext({ latencyHint: 'interactive' });
      void audioContext.resume();
      showOverlay(overlay, '<h2>Loading&hellip;</h2><p id="fof-progress"></p>');
      try {
        const platform = createPlatform(canvas, container, audioContext);
        window.__fof!.platform = platform;
        const rt = await startGameRuntime({
          log: options.log,
          modules: platform.modules,
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
      showOverlay(overlay, '<button id="fof-start" class="fof-start">Click to play Frets on Fire</button>');
      document.getElementById('fof-start')!.addEventListener('click', () => void start(), { once: true });
    }
  });
}
