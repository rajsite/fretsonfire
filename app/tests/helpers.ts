import { expect, type Page } from '@playwright/test';

// Waits for a page to publish window.__result and fails fast on captured errors.
export async function waitForResult<T = Record<string, unknown>>(page: Page, timeout = 90_000): Promise<T> {
  await page.waitForFunction(() => window.__result !== null || window.__errors?.length > 0, null, { timeout });
  const errors = await page.evaluate(() => window.__errors);
  expect(errors, errors.join('\n')).toEqual([]);
  return page.evaluate(() => window.__result as T);
}
