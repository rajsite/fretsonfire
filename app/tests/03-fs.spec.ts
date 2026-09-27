import { test, expect } from '@playwright/test';
import { waitForResult } from './helpers.ts';

interface FsResult {
  songs: Record<string, string[]>;
  lazyGuitar: { size: number; url: string | null };
  writablePath: string;
  translations: string[];
  wroteToken?: string;
  storedToken?: string;
  tests: { run: number; failures: number; errors: number; output: string };
  lazyFetches: number;
}

test('game files, song library and persistence', async ({ page }) => {
  const token = `t${Date.now()}`;
  await page.goto(`/pages/03-fs.html?token=${token}`);
  const first = await waitForResult<FsResult>(page);
  expect(Object.keys(first.songs).sort()).toEqual(['bangbang', 'defy', 'tutorial', 'twibmpg']);
  expect(first.songs.defy, JSON.stringify(first, null, 1)).toEqual(['Easy', 'Medium', 'Amazing']);
  expect(first.lazyGuitar.size).toBe(0);
  expect(first.lazyGuitar.url).toBe('/game/data/songs/defy/guitar.ogg');
  expect(first.lazyFetches).toBe(0);
  expect(first.translations).toContain('finnish.mo');
  expect(first.writablePath).toBe('/home/pyodide/.fretsonfire');
  expect(first.wroteToken).toBe(token);
  expect(first.tests.failures + first.tests.errors, first.tests.output).toBe(0);
  expect(first.tests.run).toBeGreaterThan(5);

  await page.goto(`/pages/03-fs.html?token=${token}&check`);
  const second = await waitForResult<FsResult>(page);
  expect(second.storedToken).toBe(token);
});
