import { test, expect } from '@playwright/test';
import { waitForResult } from './helpers.ts';

interface LoopResult {
  frames: number;
  nestedFrames: number;
  fetchedBytes: number;
  clicks: number;
  avgFrameMs: number;
  maxFrameMs: number;
}

test('blocking Python loops yield to the browser every frame', async ({ page }) => {
  await page.goto('/pages/02-jspi-loop.html');
  await expect.poll(async () => Number(await page.locator('#counter').textContent())).toBeGreaterThan(5);
  await page.locator('#clicker').click();
  await expect(page.locator('#clicks')).toHaveText('1');
  const result = await waitForResult<LoopResult>(page);
  expect(result.frames).toBe(120);
  expect(result.nestedFrames).toBe(30);
  expect(result.fetchedBytes).toBeGreaterThan(100);
  expect(result.clicks).toBe(1);
  expect(result.avgFrameMs).toBeLessThan(40);
});
