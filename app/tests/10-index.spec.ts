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

  // Touch frets are off by default without a touch screen, and the toggle shows them over the game.
  const touch = page.locator('#container .fof-touch');
  const toggle = page.locator('#fof-touch-toggle');
  await expect(touch).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(touch).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(touch).toBeHidden();

  await page.locator('#fof-fullscreen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe('container');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('game');
});
