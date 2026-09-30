import { createPage } from '../page.ts';
import { startGameRuntime } from '../runtime.ts';
import { createPlatform } from '../platform.ts';
import { TouchFrets } from '../touch.ts';

const { log, fail, done } = createPage();

try {
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('container')!;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const platform = createPlatform(canvas, container);
  // ?menu acts as if a menu were on top, otherwise as if a song were playing.
  const touch = new TouchFrets({
    container,
    inSong: () => !params.has('menu'),
    toggle: document.getElementById('fof-touch-toggle') as HTMLButtonElement,
  });
  platform.input.addSource(touch);
  touch.setActive(true);
  const status = document.getElementById('status')!;
  const rt = await startGameRuntime({
    log,
    modules: platform.modules,
    bridge: { setStatus: (s: string) => (status.textContent = s) },
  });
  status.textContent = 'listening';
  const frames = Number(params.get('frames') ?? 600);
  const json = await rt.pyodide.runPythonAsync(`import pages.p06_input as p; p.run(${frames})`);
  done(JSON.parse(json));
} catch (e) {
  fail(e);
}
