import { test, expect } from '@playwright/test';

test('index shows a start gate and boots the game after a click', async ({ page }) => {
  await page.goto('index.html');
  const start = page.locator('#fof-start');
  await expect(start).toBeVisible();
  await start.click();
  await expect
    .poll(() => page.evaluate(() => window.__fof?.state?.layers ?? []), { timeout: 120_000 })
    .toContain('Menu');
  await expect(page.locator('#overlay')).toBeHidden();
  const size = await page.locator('#game').boundingBox();
  expect(size!.width / size!.height).toBeCloseTo(4 / 3, 1);
});
