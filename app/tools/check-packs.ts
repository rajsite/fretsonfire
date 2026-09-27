// Manual check of real song packs against the running dev server (npm run dev):
//   node tools/check-packs.ts "C:/path/Band Hero.zip" "C:/path/Rock Band.zip::Song Folder" ...
// For each pack: index it, start the game on the given (or first) song, autoplay it and report timings.
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { openSongPack } from '../src/songpack.ts';

const BASE = process.env.FOF_BASE_URL ?? 'http://localhost:5173/';

interface State {
  layers: string[];
  notesHit?: number;
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const arg of process.argv.slice(2)) {
  const [zip, songDir] = arg.split('::');
  const blob = await openAsBlob(zip);
  const pack = await openSongPack(Object.assign(blob, { name: path.basename(zip) }));
  const song = `${pack.name}/${songDir ?? pack.layout.songs[0]}`;
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().startsWith('(E)')) errors.push(m.text());
  });
  const state = () => page.evaluate(() => (window.__fof?.state ?? { layers: [] }) as State);
  const waitFor = async (check: (s: State) => boolean, timeout: number) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (check(await state())) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };

  await page.goto(`${BASE}index.html?arg=--play&arg=${encodeURIComponent(song)}`);
  const t0 = Date.now();
  await page.locator('#fof-pack-input').setInputFiles(zip);
  await page.locator('#fof-pack-status.fof-pack-ok').waitFor({ timeout: 60_000 });
  const tIndex = Date.now();
  const status = await page.locator('#fof-pack-status').textContent();
  await page.locator('#fof-start').click();
  const inGame = await waitFor((s) => s.layers.includes('GuitarSceneClient') || s.layers.includes('MessageScreen'), 180_000) && (await state()).layers.includes('GuitarSceneClient');
  const tGame = Date.now();
  let notesHit = 0;
  if (inGame) {
    await page.keyboard.type('uptomytempo', { delay: 30 });
    await page.waitForTimeout(20_000);
    notesHit = (await state()).notesHit ?? 0;
  }
  const audio = await page.evaluate(() => window.__fof?.platform?.audio().stats());
  console.log(
    JSON.stringify({
      pack: pack.name,
      status,
      song,
      indexMs: tIndex - t0,
      startToSongMs: tGame - tIndex,
      inGame,
      layers: (await state()).layers,
      notesHit,
      playingSounds: audio?.playingSounds,
      cached: audio?.cached.length,
      errors: errors.slice(0, 5),
    }),
  );
  await page.close();
}
await browser.close();
