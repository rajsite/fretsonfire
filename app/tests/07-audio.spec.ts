import { test, expect } from '@playwright/test';
import { waitForResult } from './helpers.ts';

interface AudioResult {
  samples: number;
  finalPos: number;
  maxDrift: number;
  monotonic: boolean;
  events: (string | { pausedDrift: number })[];
  playingAtEnd: boolean;
  info: { sampleRate: number; state: string };
}

test('song tracks play on Web Audio with a stable clock', async ({ page }) => {
  await page.goto('pages/07-audio.html?autostart&seconds=6');
  const result = await waitForResult<AudioResult>(page, 120_000);
  expect(result.info.state).toBe('running');
  expect(result.monotonic).toBe(true);
  expect(result.playingAtEnd).toBe(true);
  expect(result.finalPos).toBeGreaterThan(3000);
  expect(result.maxDrift).toBeLessThan(40);
  const paused = result.events.find((e) => typeof e === 'object') as { pausedDrift: number };
  expect(Math.abs(paused.pausedDrift)).toBeLessThan(1);
});
