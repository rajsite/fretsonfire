import { launchGame } from './game.ts';

const params = new URLSearchParams(location.search);
const argv = params.getAll('arg');
if (params.has('verbose')) argv.push('-v');

void launchGame({
  container: document.getElementById('container')!,
  canvas: document.getElementById('game') as HTMLCanvasElement,
  overlay: document.getElementById('overlay')!,
  argv,
  autostart: params.has('autostart'),
});
