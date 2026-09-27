import { test, expect, type Page } from '@playwright/test';
import { waitForResult } from './helpers.ts';
import { makeTestPack, RB_GUITAR_NOTES } from './fixtures/make-pack.ts';
import { layoutPack, safeSegments, packName } from '../src/songpack.ts';
import { openZip } from '../src/zip.ts';

const PACK = { name: 'Test Pack.zip', mimeType: 'application/zip', buffer: Buffer.from(makeTestPack()) };

interface PackResult {
  root: string;
  topLibraries: string[];
  libraries: Record<string, { name: string; songs: Record<string, { name: string; difficulties: string[] }> }>;
  rbNotes: Record<string, number>;
  rbGuitarTrack: number;
  labels: Record<string, boolean>;
  oggStubSize: number;
  oggOrigin: string;
  oggSeconds: number;
}

test('pack layout rules', async () => {
  expect(safeSegments('a\\b/./c')).toEqual(['a', 'b', 'c']);
  expect(safeSegments('../x')).toBeNull();
  expect(safeSegments('a/../../x')).toBeNull();
  expect(safeSegments('/etc/passwd')).toBeNull();
  expect(safeSegments('C:/x')).toBeNull();
  expect(packName('Band Hero.zip')).toBe('Band Hero');
  expect(packName('.zip')).toBe('Song pack');

  const archive = await openZip(new Blob([PACK.buffer]));
  const layout = layoutPack(archive.entries);
  expect(layout.songs).toEqual(['Classic/03 M\u00f6tley', 'Rock Band/01 RB Style', 'Rock Band/02 Guitar Only']);
  expect(layout.libraries).toEqual(['']);
  expect(layout.warnings).toEqual(['../evil.ini: unsafe path, skipped', 'Test Pack/Classic/05 Secret/song.ini: encrypted or unsupported compression, skipped']);
  const files = layout.files.map((f) => `${f.path}${f.eager ? ' (eager)' : ''}`).sort();
  expect(files).toEqual([
    'Classic/03 M\u00f6tley/guitar.ogg',
    'Classic/03 M\u00f6tley/label.png',
    'Classic/03 M\u00f6tley/notes.mid (eager)',
    'Classic/03 M\u00f6tley/song.ini (eager)',
    'Classic/03 M\u00f6tley/song.ogg',
    'Rock Band/01 RB Style/drums.ogg',
    'Rock Band/01 RB Style/guitar.ogg',
    'Rock Band/01 RB Style/label.png',
    'Rock Band/01 RB Style/notes.mid (eager)',
    'Rock Band/01 RB Style/rhythm.ogg',
    'Rock Band/01 RB Style/song.ini (eager)',
    'Rock Band/01 RB Style/song.ogg',
    'Rock Band/02 Guitar Only/guitar.ogg',
    'Rock Band/02 Guitar Only/notes.mid (eager)',
    'Rock Band/02 Guitar Only/song.ini (eager)',
    'label.png',
  ]);

  // A zip holding a single song folder keeps that folder.
  const single = layoutPack([
    { name: 'Only Song/song.ini', method: 8, flags: 0, compressedSize: 1, size: 1, localOffset: 0 },
    { name: 'Only Song/notes.mid', method: 8, flags: 0, compressedSize: 1, size: 1, localOffset: 0 },
  ]);
  expect(single.songs).toEqual(['Only Song']);
});

test('a mounted pack is visible to the game library and song APIs', async ({ page }) => {
  await page.goto('pages/12-song-pack.html');
  await page.locator('#pack').setInputFiles(PACK);
  const r = await waitForResult<PackResult>(page);
  expect(r.root).toBe('/game/data/songs/Test Pack');
  expect(r.topLibraries).toEqual(['songs/Test Pack']);
  expect(Object.keys(r.libraries).sort()).toEqual(['songs/Test Pack', 'songs/Test Pack/Classic', 'songs/Test Pack/Rock Band']);
  expect(r.libraries['songs/Test Pack'].name).toBe('Test Pack');
  const rb = r.libraries['songs/Test Pack/Rock Band'].songs;
  expect(Object.keys(rb).sort()).toEqual(['01 RB Style', '02 Guitar Only']);
  expect(rb['01 RB Style']).toEqual({ name: 'RB Style', difficulties: ['Medium', 'Amazing'] });
  expect(rb['02 Guitar Only'].difficulties).toEqual(['Easy', 'Medium', 'Amazing']);
  expect(Object.keys(r.libraries['songs/Test Pack/Classic'].songs)).toEqual(['03 M\u00f6tley']);
  expect(r.rbGuitarTrack).toBe(3);
  expect(r.rbNotes).toMatchObject({ Amazing: RB_GUITAR_NOTES, Medium: RB_GUITAR_NOTES, Easy: 0 });
  expect(Object.values(r.labels)).toEqual([true, true, true]);
  expect(r.oggStubSize).toBe(0);
  expect(r.oggOrigin).toBe('zip:Test Pack/Rock Band/01 RB Style/Song.ogg');
  expect(r.oggSeconds).toBeGreaterThan(10);
});

async function state(page: Page) {
  return page.evaluate(() => window.__fof?.state ?? { layers: [] as string[], score: 0, notesHit: 0 });
}

test('the start gate takes a song pack and plays a song from it', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(`index.html?arg=--play&arg=${encodeURIComponent('Test Pack/Rock Band/01 RB Style')}`);
  await page.evaluate(() => localStorage.removeItem('fof.songPack'));
  await page.locator('#fof-pack-input').setInputFiles(PACK);
  await expect(page.locator('#fof-pack-status')).toHaveText('Test Pack: 3 songs, 2 files skipped');
  await page.locator('#fof-start').click();
  await expect.poll(async () => (await state(page)).layers, { timeout: 120_000 }).toContain('GuitarSceneClient');
  const dir = await page.evaluate(() => window.__fof!.runtime!.pyodide.FS.readdir('/game/data/songs/Test Pack/Rock Band/01 RB Style') as string[]);
  expect(dir.filter((f) => !f.startsWith('.')).sort()).toEqual(['drums.ogg', 'guitar.ogg', 'label.png', 'notes.mid', 'rhythm.ogg', 'song.ini', 'song.ogg']);

  await page.keyboard.type('uptomytempo', { delay: 30 });
  await expect.poll(async () => (await state(page)).notesHit ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(10);

  await page.goto('index.html');
  await expect(page.locator('#fof-pack-status')).toHaveText('Select Test Pack.zip again to use your song pack');
});
