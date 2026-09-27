import { test, expect } from '@playwright/test';
import { decodePov, normalizePad, describePad, type PadInput } from '../src/gamepad.ts';
import { waitForResult } from './helpers.ts';

const RB_ID = 'Harmonix Guitar for PlayStation®3 (Vendor: 12ba Product: 0200)';
const POV_CENTER = 9 / 7;

function pad(id: string, mapping: string, pressed: number[], axes: number[], buttons = 13): PadInput {
  return { id, mapping, buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: pressed.includes(i) })), axes };
}

test('POV hats encoded as one axis decode to hat positions', () => {
  // Values captured from a PS3 Rock Band guitar in Chrome on Windows.
  expect(decodePov(-1)).toEqual([0, 1]);
  expect(decodePov(-0.428571)).toEqual([1, 0]);
  expect(decodePov(0.142857)).toEqual([0, -1]);
  expect(decodePov(0.714286)).toEqual([-1, 0]);
  expect(decodePov(-0.714286)).toEqual([1, 1]);
  expect(decodePov(-0.142857)).toEqual([1, -1]);
  expect(decodePov(0.428571)).toEqual([-1, -1]);
  expect(decodePov(1)).toEqual([-1, 1]);
  expect(decodePov(POV_CENTER)).toEqual([0, 0]);
});

test('guitar profiles normalize to frets 0-4, select 8, start 9 and a strum hat', () => {
  const rest = [0.003922, 0.003922, -0.003922, 0, 0, -0.003922, 0, 0, 0, POV_CENTER];
  // Frets G R Y B O are raw buttons 1 2 3 0 4; button 6 is the solo modifier.
  const rb = normalizePad(pad(RB_ID, '', [1, 0, 6, 9], [...rest.slice(0, 9), -1]), new Set());
  expect(rb.profile).toBe('Harmonix Guitar (PS3)');
  expect(rb.buttons).toEqual([true, false, false, true, false, false, false, false, false, true]);
  expect(rb.hats).toEqual([[0, 1]]);
  expect(rb.axes).toEqual([]);
  expect(normalizePad(pad(RB_ID, '', [], rest), new Set()).hats).toEqual([[0, 0]]);

  // Xbox 360 guitars: frets on A B Y X LB, strum on the d-pad.
  const std = normalizePad(pad('Xbox 360 Guitar', 'standard', [3, 13, 8], [0, 0, 0, 0], 17), new Set());
  expect(std.profile).toBe('Standard gamepad');
  expect(std.buttons).toEqual([false, false, true, false, false, false, false, false, true, false]);
  expect(std.hats).toEqual([[0, -1]]);

  expect(describePad(pad(RB_ID, '', [], rest))).toBe('Harmonix Guitar (PS3)');
  expect(describePad(pad('Xbox 360 Guitar (XInput STANDARD GAMEPAD)', 'standard', [], []))).toBe('Xbox 360 Guitar');
});

test('PS3 Rock Band guitar on Android uses its own layout', () => {
  // Layout recorded in Chrome on Android: lower frets G R Y B O read as 1+4, 4, 2+4, 0+4, 3+4.
  const id = 'Licensed by Sony Computer Entertainment America Harmonix Guitar for PlayStation (Vendor: 12ba Product: 0200)';
  const android = (pressed: number[]) => normalizePad(pad(id, '', pressed, [0, 0, -0.003922, 0], 17), new Set());
  const frets = (pressed: number[]) => android(pressed).buttons.slice(0, 5);
  expect(android([]).profile).toBe('Harmonix Guitar (PS3, Android)');
  expect(frets([1, 4])).toEqual([true, false, false, false, false]);
  expect(frets([4])).toEqual([false, true, false, false, false]);
  expect(frets([2, 4])).toEqual([false, false, true, false, false]);
  expect(frets([0, 4])).toEqual([false, false, false, true, false]);
  expect(frets([3])).toEqual([false, false, false, false, true]);
  expect(android([6]).buttons[8]).toBe(true);
  expect(android([7]).buttons[9]).toBe(true);
  expect(android([12]).hats).toEqual([[0, 1]]);
  expect(android([13]).hats).toEqual([[0, -1]]);
});

test('unknown gamepads pass through, with POV axes turned into hats', () => {
  const povAxes = new Set<number>();
  const first = normalizePad(pad('Some pad', '', [2], [0.5, POV_CENTER], 4), povAxes);
  expect(first.profile).toBeNull();
  expect(first.buttons).toEqual([false, false, true, false]);
  expect(first.axes).toEqual([0.5, 0]);
  expect(first.hats).toEqual([[0, 0]]);
  // Once known, a pressed POV (a value inside -1..1) still reads as a hat.
  expect(normalizePad(pad('Some pad', '', [], [0.5, -1], 4), povAxes).hats).toEqual([[0, 1]]);
});

interface InputResult {
  log: { pressed: number[]; released: number[]; controls: (number | null)[] };
}

test('a simulated PS3 guitar drives frets, strums and start in the game', async ({ page }) => {
  await page.addInitScript(
    ({ id, center }) => {
      const pad = {
        id,
        index: 0,
        connected: true,
        mapping: '',
        timestamp: 0,
        buttons: Array.from({ length: 13 }, () => ({ pressed: false, touched: false, value: 0 })),
        axes: [0.003922, 0.003922, -0.003922, 0, 0, -0.003922, 0, 0, 0, center],
      };
      (window as unknown as { __pad: typeof pad }).__pad = pad;
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    },
    { id: RB_ID, center: POV_CENTER },
  );
  await page.goto('pages/06-input.html?frames=600');
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 60_000 });
  await page.evaluate(() => dispatchEvent(new Event('gamepadconnected')));

  const setButton = (b: number, down: boolean) =>
    page.evaluate(([b, down]) => {
      (window as unknown as { __pad: { buttons: { pressed: boolean }[] } }).__pad.buttons[b as number].pressed = down as boolean;
    }, [b, down] as const);
  const setStrum = (value: number) =>
    page.evaluate((v) => {
      (window as unknown as { __pad: { axes: number[] } }).__pad.axes[9] = v;
    }, value);
  const tap = async (b: number) => {
    await setButton(b, true);
    await page.waitForTimeout(80);
    await setButton(b, false);
    await page.waitForTimeout(80);
  };
  const strum = async (value: number) => {
    await setStrum(value);
    await page.waitForTimeout(80);
    await setStrum(POV_CENTER);
    await page.waitForTimeout(80);
  };

  for (const b of [1, 2, 3, 0, 4]) await tap(b);
  await strum(-1);
  await strum(0.142857);
  await tap(9);
  await tap(8);
  // A strum shorter than a frame is still seen by the between-frame poller.
  await page.evaluate(
    (center) =>
      new Promise<void>((resolve) => {
        const pad = (window as unknown as { __pad: { axes: number[] } }).__pad;
        pad.axes[9] = -1;
        setTimeout(() => {
          pad.axes[9] = center;
          resolve();
        }, 10);
      }),
    POV_CENTER,
  );

  const result = await waitForResult<InputResult>(page);
  // Player controls: KEY1..KEY5, ACTION1 (pick), ACTION2 (secondary pick), CANCEL; select is unbound.
  expect(result.log.controls).toEqual([0x40, 0x80, 0x100, 0x200, 0x400, 0x10, 0x20, 0x800, null, 0x10]);
  expect(result.log.released.length).toBe(result.log.pressed.length);
});
