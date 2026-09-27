import { test, expect } from '@playwright/test';
import { waitForResult } from './helpers.ts';

interface InputResult {
  log: { pressed: number[]; released: number[]; unicode: string[]; mouse: [string, number, number[]][] };
  keys: Record<string, number>;
  keyNameF1: string;
  controlsKey1: number;
  prevented: number;
}

test('keyboard and mouse reach the game Input task without browser side effects', async ({ page }) => {
  await page.goto('/pages/06-input.html');
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 60_000 });
  const url = page.url();
  for (const key of ['F1', 'F2', 'F5', 'Enter', 'Escape', 'a', 'ArrowLeft']) {
    await page.keyboard.press(key);
  }
  await page.locator('#game').click({ position: { x: 10, y: 20 } });
  const result = await waitForResult<InputResult>(page);
  const k = result.keys;
  expect(result.log.pressed).toEqual([k.K_F1, k.K_F2, k.K_F5, k.K_RETURN, k.K_ESCAPE, k.K_a, k.K_LEFT]);
  expect(result.log.released).toEqual(result.log.pressed);
  expect(result.log.unicode[5]).toBe('a');
  expect(result.log.mouse[0][1]).toBe(1);
  expect(result.keyNameF1).toBe('f1');
  expect(result.controlsKey1).toBe(0x40);
  expect(result.prevented).toBeGreaterThanOrEqual(14);
  expect(page.url()).toBe(url);
});
