import { createPage } from '../page.ts';
import { startGameRuntime } from '../runtime.ts';
import { createPlatform } from '../platform.ts';

const { log, fail, done } = createPage();
const params = new URLSearchParams(location.search);
const token = params.get('token') ?? String(Date.now());
const check = params.has('check');

try {
  const t0 = performance.now();
  const rt = await startGameRuntime({
    log,
    modules: createPlatform(document.createElement('canvas')).modules,
    onProgress: (loaded, total) => {
      document.getElementById('progress')!.textContent = `${Math.round(loaded / 1024)} / ${Math.round(total / 1024)} KB`;
    },
  });
  log(`game files: ${rt.files.fetched} files, ${Math.round(rt.files.bytes / 1024)} KB, ${rt.files.lazy.size} lazy, ${Math.round(performance.now() - t0)} ms`);
  const lazyFetches = performance.getEntriesByType('resource').filter((e) => e.name.includes('/songs/') && e.name.endsWith('.ogg')).length;
  const json = await rt.pyodide.runPythonAsync(
    `import pages.p03_fs as p; p.run(${JSON.stringify(token)}, ${check ? 'True' : 'False'})`,
  );
  await rt.persist();
  done({ ...JSON.parse(json), fetched: rt.files.fetched, lazyCount: rt.files.lazy.size, lazyFetches });
} catch (e) {
  fail(e);
}
