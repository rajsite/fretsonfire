import { launchGame } from './game.ts';
import { toggleFullscreen } from './platform.ts';

const params = new URLSearchParams(location.search);
const argv = params.getAll('arg');
if (params.has('verbose')) argv.push('-v');

const container = document.getElementById('container')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
document.getElementById('fof-fullscreen')!.addEventListener('click', () => {
  toggleFullscreen(container);
  // Keep keyboard input going to the game rather than the button.
  canvas.focus();
});
const touchToggle = document.getElementById('fof-touch-toggle') as HTMLButtonElement;
touchToggle.addEventListener('click', () => canvas.focus());

void launchGame({
  container,
  canvas,
  overlay: document.getElementById('overlay')!,
  argv,
  autostart: params.has('autostart'),
  touchToggle,
});
