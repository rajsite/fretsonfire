import { createPage } from '../page.ts';
import { startGameRuntime } from '../runtime.ts';
import { createPlatform } from '../platform.ts';

const { log, fail, done } = createPage();

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const platform = createPlatform(canvas);
  const status = document.getElementById('status')!;
  const rt = await startGameRuntime({
    log,
    modules: platform.modules,
    bridge: { setStatus: (s: string) => (status.textContent = s) },
  });
  canvas.focus();
  status.textContent = 'listening';
  const json = await rt.pyodide.runPythonAsync('import pages.p06_input as p; p.run(360)');
  done({ ...JSON.parse(json), prevented: platform.input.prevented });
} catch (e) {
  fail(e);
}
