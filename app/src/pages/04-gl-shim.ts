import { createPage } from '../page.ts';
import { startGameRuntime } from '../runtime.ts';
import { GLBackend } from '../gl/backend.ts';

const { log, fail, done } = createPage();
const scene = new URLSearchParams(location.search).get('scene') ?? 'primitives';
document.getElementById('scene')!.textContent = scene;

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const backend = new GLBackend(canvas);
  const rt = await startGameRuntime({ log, modules: { fofgl: backend } });
  const json = await rt.pyodide.runPythonAsync(`import pages.p04_gl as p; p.run(${JSON.stringify(scene)})`);
  const glError = backend.gl.getError();
  done({ ...JSON.parse(json), draws: backend.stats.draws, glError });
} catch (e) {
  fail(e);
}
