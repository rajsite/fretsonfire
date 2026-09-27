import { test, expect, type Page } from '@playwright/test';

async function layers(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__fof?.state?.layers ?? []);
}

async function press(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}

test('game boots to the main menu and navigates menus', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().startsWith('(E)')) errors.push(m.text());
  });
  await page.goto('pages/08-engine.html?autostart&verbose');
  await expect.poll(() => layers(page), { timeout: 90_000 }).toContain('Menu');
  await page.waitForTimeout(1500);
  await expect(page.locator('#game')).toHaveScreenshot('main-menu.png', { maxDiffPixelRatio: 0.03 });

  // Settings > (4th item) and back out.
  await press(page, 'ArrowDown', 3);
  await press(page, 'Enter');
  await expect.poll(() => layers(page)).toContain('SettingsMenu');
  await page.waitForTimeout(800);
  await expect(page.locator('#game')).toHaveScreenshot('settings-menu.png', { maxDiffPixelRatio: 0.03 });
  await press(page, 'Escape');
  await expect.poll(async () => (await layers(page)).includes('SettingsMenu')).toBe(false);

  // Credits (5th item) scroll for a while, then escape.
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await expect.poll(() => layers(page), { timeout: 30_000 }).toContain('Credits');
  await page.waitForTimeout(2000);
  await expect(page.locator('#game')).toHaveScreenshot('credits.png', { maxDiffPixelRatio: 0.2 });
  await press(page, 'Escape');
  await expect.poll(() => layers(page), { timeout: 30_000 }).toContain('Menu');

  expect(errors).toEqual([]);
});
