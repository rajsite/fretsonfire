// Frame pacing for the JSPI main loop: Python suspends on nextFrame() once per frame.
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
