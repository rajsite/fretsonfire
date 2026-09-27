import { createPage } from '../page.ts';
import { loadRuntime } from '../boot.ts';

const { log, fail, done } = createPage();

try {
  const t0 = performance.now();
  const pyodide = await loadRuntime({ log });
  log(`runtime loaded in ${Math.round(performance.now() - t0)} ms`);
  const info = await pyodide.runPythonAsync(`
import sys, json
import numpy, PIL, pygame
from pyodide.ffi import can_run_sync
json.dumps({
  "python": sys.version.split()[0],
  "platform": sys.platform,
  "numpy": numpy.__version__,
  "pillow": PIL.__version__,
  "pygame": pygame.version.ver,
  "sdl": ".".join(map(str, pygame.get_sdl_version())),
  "jspi": can_run_sync(),
})
`);
  done(JSON.parse(info));
} catch (e) {
  fail(e);
}
