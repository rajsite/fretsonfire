import { createPage } from '../page.ts';
import { startGameRuntime } from '../runtime.ts';
import { createPlatform } from '../platform.ts';

const { log, fail, done } = createPage();
const button = document.getElementById('start') as HTMLButtonElement;

async function run(): Promise<void> {
  button.disabled = true;
  try {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const platform = createPlatform(canvas);
    const rt = await startGameRuntime({ log, modules: platform.modules });
    await platform.audio().resume();
    const seconds = Number(new URLSearchParams(location.search).get('seconds') ?? 6);
    const json = await rt.pyodide.runPythonAsync(`import pages.p07_audio as p; p.run(${seconds})`);
    done(JSON.parse(json));
  } catch (e) {
    fail(e);
  }
}

button.addEventListener('click', () => void run());
if (new URLSearchParams(location.search).has('autostart')) void run();
