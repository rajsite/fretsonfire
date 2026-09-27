import { createPage } from '../page.ts';
import { loadRuntime } from '../boot.ts';
import { GAME_URL, installGameFiles, setupPythonPath } from '../fs.ts';
import { nextFrame } from '../frame.ts';

const { log, fail, done } = createPage();
const counter = document.getElementById('counter')!;
let clicks = 0;
document.getElementById('clicker')!.addEventListener('click', () => {
  clicks++;
  document.getElementById('clicks')!.textContent = String(clicks);
});

try {
  const pyodide = await loadRuntime({ log, packages: [] });
  await installGameFiles(pyodide, { include: (p) => p.startsWith('app-python/') });
  setupPythonPath(pyodide);
  pyodide.registerJsModule('fofjs', {
    nextFrame,
    gameUrl: GAME_URL,
    setCounter: (n: number) => (counter.textContent = String(n)),
    clickCount: () => clicks,
  });
  const result = await pyodide.runPythonAsync('import pages.p02_jspi_loop as p; p.run()');
  done(JSON.parse(result));
} catch (e) {
  fail(e);
}
