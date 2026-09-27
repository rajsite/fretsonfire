import { test, expect } from '@playwright/test';
import { waitForResult } from './helpers.ts';

interface BootResult {
  python: string;
  platform: string;
  numpy: string;
  pillow: string;
  pygame: string;
  jspi: boolean;
}

test('pyodide boots with numpy, pillow, pygame-ce and JSPI', async ({ page }) => {
  await page.goto('/pages/01-boot.html');
  const result = await waitForResult<BootResult>(page);
  expect(result.python).toMatch(/^3\.14\./);
  expect(result.platform).toBe('emscripten');
  expect(result.numpy).toBe('2.4.6');
  expect(result.pillow).toBe('12.2.0');
  expect(result.pygame).toBe('2.5.7');
  expect(result.jspi).toBe(true);
});
