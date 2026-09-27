import { test, expect } from '@playwright/test';
import { waitForResult } from './helpers.ts';

interface GlResult {
  draws: number;
  glError: number;
  vertices: number;
  pythonMs: number;
}

const expectedDraws: Record<string, number> = {
  primitives: 5,
  texture: 2,
  svg: 2,
  depth: 3,
  mesh: 25,
  arrays: 1,
  font: 6,
};

for (const [scene, draws] of Object.entries(expectedDraws)) {
  test(`gl scene: ${scene}`, async ({ page }) => {
    await page.goto(`pages/04-gl-shim.html?scene=${scene}`);
    const result = await waitForResult<GlResult>(page);
    expect(result.glError).toBe(0);
    expect(result.draws).toBeGreaterThanOrEqual(draws);
    await expect(page.locator('#game')).toHaveScreenshot(`gl-${scene}.png`, { maxDiffPixelRatio: 0.02 });
  });
}
