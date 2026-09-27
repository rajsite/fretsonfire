import { createPage } from '../page.ts';
import { startGameRuntime } from '../runtime.ts';
import { createPlatform } from '../platform.ts';
import { openSongPack } from '../songpack.ts';

const { log, fail, done } = createPage();
const input = document.getElementById('pack') as HTMLInputElement;

input.addEventListener('change', async () => {
  try {
    const file = input.files![0];
    const t0 = performance.now();
    const pack = await openSongPack(file);
    const t1 = performance.now();
    log(`${pack.name}: ${pack.layout.songs.length} songs, ${pack.layout.files.length} files, index ${Math.round(t1 - t0)} ms`);
    for (const w of pack.layout.warnings) log(`warning: ${w}`);
    const platform = createPlatform(document.createElement('canvas'));
    const rt = await startGameRuntime({ log, modules: platform.modules, songPack: pack });
    const root = rt.songPackRoot!;
    const json = await rt.pyodide.runPythonAsync(`import pages.p12_song_pack as p; p.run(${JSON.stringify(root)})`);
    done({
      ...JSON.parse(json),
      name: pack.name,
      root,
      layout: { songs: pack.layout.songs, libraries: pack.layout.libraries, warnings: pack.layout.warnings },
      lazy: [...rt.files.lazy.keys()].filter((k) => k.startsWith(`${root}/`)).map((k) => k.slice(root.length + 1)).sort(),
    });
  } catch (e) {
    fail(e);
  }
});
