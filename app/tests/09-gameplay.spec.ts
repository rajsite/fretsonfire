import { test, expect, type Page } from '@playwright/test';

async function state(page: Page) {
  return page.evaluate(() => window.__fof?.state ?? { layers: [] as string[], score: 0, notesHit: 0 });
}

test('plays a song with the built-in autoplay cheat and scores', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (process.env.FOF_DEBUG) console.log(`[page] ${m.text()}`);
    if (m.type() === 'error' || m.text().startsWith('(E)')) errors.push(m.text());
  });
  page.on('framenavigated', (f) => {
    if (process.env.FOF_DEBUG && f === page.mainFrame()) console.log(`[nav] ${f.url()}`);
  });
  const frameTimes: number[] = [];
  await page.exposeFunction('__frame', (ms: number) => frameTimes.push(ms));

  // --play jumps straight into the single player lobby for the song.
  await page.goto('/pages/08-engine.html?autostart&verbose&arg=--play&arg=defy');
  await expect.poll(async () => (await state(page)).layers, { timeout: 120_000 }).toContain('GuitarSceneClient');

  // "uptomytempo" toggles the game's autoplay mode (and shows a message layer while it plays).
  await page.keyboard.type('uptomytempo', { delay: 30 });
  await page.evaluate(() => {
    let last = performance.now();
    const tick = (now: number) => {
      (window as unknown as { __frame: (ms: number) => void }).__frame(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(20_000);
  await expect(page.locator('#game')).toHaveScreenshot('gameplay.png', { maxDiffPixelRatio: 0.5 });
  const s = await state(page);
  if (process.env.FOF_DEBUG) console.log(`[state] ${JSON.stringify(s)}`);
  expect(s.notesHit ?? 0).toBeGreaterThan(10);
  expect(s.score ?? 0).toBeGreaterThan(500);

  const sorted = [...frameTimes].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`frames: ${sorted.length}, median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  expect(errors).toEqual([]);
});
