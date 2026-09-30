import { test, expect, type Page } from '@playwright/test';
import { TouchFretState, TOUCH_JOY, CHORD_WINDOW_MS } from '../src/touch.ts';
import type { InputEvent } from '../src/input.ts';
import { waitForResult } from './helpers.ts';

const fret = (button: number, down: boolean): InputEvent => ({ t: 'joybutton', joy: TOUCH_JOY, button, down });
const hat = (y: number): InputEvent => ({ t: 'joyhat', joy: TOUCH_JOY, hat: 0, x: 0, y });
const STRUM = [hat(1), hat(0)];

test('a fret press strums once its chord window closes', () => {
  const s = new TouchFretState();
  s.press(0, 1000, true);
  expect(s.drain(1000, true)).toEqual([fret(0, true)]);
  s.press(2, 1000 + CHORD_WINDOW_MS - 1, true);
  expect(s.drain(1000 + CHORD_WINDOW_MS - 1, true)).toEqual([fret(2, true)]);
  expect(s.drain(1000 + CHORD_WINDOW_MS, true)).toEqual(STRUM);
  s.release(0);
  s.release(2);
  expect(s.drain(2000, true)).toEqual([fret(0, false), fret(2, false)]);
});

test('a tap released before its strum keeps the fret down until the strum', () => {
  const s = new TouchFretState();
  s.press(1, 0, true);
  s.release(1);
  expect(s.isHeld(1)).toBe(true);
  expect(s.drain(CHORD_WINDOW_MS, true)).toEqual([fret(1, true), ...STRUM, fret(1, false)]);
  expect(s.isHeld(1)).toBe(false);
});

test('sliding to another fret releases the old one and strums the new one', () => {
  const s = new TouchFretState();
  s.press(0, 0, true);
  s.drain(100, true);
  s.release(0);
  s.press(3, 200, true);
  expect(s.drain(200 + CHORD_WINDOW_MS, true)).toEqual([fret(0, false), fret(3, true), ...STRUM]);
});

test('two fingers on one fret keep it down until both lift', () => {
  const s = new TouchFretState();
  s.press(4, 0, false);
  s.press(4, 0, false);
  s.release(4);
  expect(s.drain(0, false)).toEqual([fret(4, true)]);
  s.release(4);
  s.release(4);
  expect(s.drain(0, false)).toEqual([fret(4, false)]);
});

test('outside a song frets do not strum, and the nav buttons send menu controls', () => {
  const s = new TouchFretState();
  s.press(0, 0, false);
  s.release(0);
  s.nav('down');
  s.nav('up');
  s.nav('back');
  expect(s.drain(100, false)).toEqual([
    fret(0, true),
    fret(0, false),
    hat(-1),
    hat(0),
    hat(1),
    hat(0),
    fret(9, true),
    fret(9, false),
  ]);
});

test('releaseAll lifts held frets and drops a pending strum', () => {
  const s = new TouchFretState();
  s.press(0, 0, true);
  s.press(1, 0, true);
  s.release(1);
  s.releaseAll();
  expect(s.drain(100, true)).toEqual([fret(0, true), fret(1, true), fret(0, false), fret(1, false)]);
});

// Player control flags.
const [ACTION1, ACTION2, KEY1, KEY2, KEY3, KEY4, CANCEL] = [0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x800];

interface TouchResult {
  log: { pressed: number[]; released: number[]; controls: (number | null)[] };
}

async function touchPage(page: Page, query = '') {
  await page.goto(`pages/14-touch.html${query}`);
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 60_000 });
  const cdp = await page.context().newCDPSession(page);
  const frets = page.locator('.fof-touch-fret');
  return {
    fret: async (i: number) => {
      const b = (await frets.nth(i).boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    // Multi-touch needs raw touch points; page.touchscreen only taps with one finger.
    touch: (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: { x: number; y: number; id: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints }),
  };
}

function expectAllReleased(result: TouchResult) {
  expect([...result.log.released].sort()).toEqual([...result.log.pressed].sort());
}

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('in a song, chords strum once, sliding strums the new fret and Pause cancels', async ({ page }) => {
    const { fret, touch } = await touchPage(page);
    await expect(page.locator('.fof-touch')).toBeVisible();
    await expect(page.locator('.fof-touch-nav')).toBeHidden();
    await expect(page.locator('.fof-touch-pause')).toHaveText('Pause');

    await touch('touchStart', [
      { ...(await fret(0)), id: 0 },
      { ...(await fret(2)), id: 1 },
    ]);
    await page.waitForTimeout(200);
    await touch('touchEnd', []);

    await touch('touchStart', [{ ...(await fret(1)), id: 2 }]);
    // Long enough for the game to take the strum before the finger slides, even with slow frames.
    await page.waitForTimeout(500);
    await touch('touchMove', [{ ...(await fret(3)), id: 2 }]);
    await page.waitForTimeout(500);
    await touch('touchEnd', []);

    await page.locator('.fof-touch-pause').tap();
    const result = await waitForResult<TouchResult>(page);
    expect(result.log.controls).toEqual([KEY1, KEY3, ACTION1, KEY2, ACTION1, KEY4, ACTION1, CANCEL]);
    expectAllReleased(result);
  });

  test('in menus, frets do not strum and the arrows move up and down', async ({ page }) => {
    const { fret, touch } = await touchPage(page, '?menu');
    await expect(page.locator('.fof-touch-pause')).toHaveText('Back');
    await touch('touchStart', [{ ...(await fret(0)), id: 0 }]);
    await page.waitForTimeout(200);
    await touch('touchEnd', []);
    await page.locator('.fof-touch-nav [data-nav=down]').tap();
    await page.locator('.fof-touch-nav [data-nav=up]').tap();
    await page.locator('.fof-touch-pause').tap();
    const result = await waitForResult<TouchResult>(page);
    expect(result.log.controls).toEqual([KEY1, ACTION2, ACTION1, CANCEL]);
    expectAllReleased(result);
  });

  test('turning touch frets off is remembered', async ({ page }) => {
    await page.goto('pages/14-touch.html?frames=1');
    const bar = page.locator('.fof-touch');
    const toggle = page.locator('#fof-touch-toggle');
    await expect(bar).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.tap();
    await expect(bar).toBeHidden();
    // Reloading while game files download would abort them with console errors.
    await expect(page.locator('#status')).not.toHaveText('loading', { timeout: 60_000 });
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(bar).toBeHidden();
  });

  test('in portrait and landscape the game keeps its shape and the frets stay on it, clear of the links', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('index.html');
    await page.locator('#fof-start').tap();
    await expect.poll(() => page.evaluate(() => window.__fof?.state?.top ?? null), { timeout: 120_000 }).toBe('Menu');
    await expect(page.locator('.fof-keys').first()).toBeHidden();
    for (const viewport of [
      { width: 412, height: 915 },
      { width: 915, height: 412 },
    ]) {
      await page.setViewportSize(viewport);
      const game = (await page.locator('#game').boundingBox())!;
      const touch = (await page.locator('.fof-touch').boundingBox())!;
      const bar = (await page.locator('.fof-touch-bar').boundingBox())!;
      const links = (await page.locator('.fof-links').boundingBox())!;
      expect(game.width / game.height).toBeCloseTo(4 / 3, 2);
      expect(Math.max(game.width / viewport.width, game.height / viewport.height)).toBeCloseTo(1, 2);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(touch[key]).toBeCloseTo(game[key], 0);
      expect(links.y + links.height).toBeLessThanOrEqual(bar.y);
    }
  });
});
