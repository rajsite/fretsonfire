import { test, expect } from '@playwright/test';
import { TouchFretState, TOUCH_JOY, CHORD_WINDOW_MS } from '../src/touch.ts';
import type { InputEvent } from '../src/input.ts';

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
