import { createPage } from '../page.ts';
import { launchGame } from '../game.ts';

const { log, fail, done } = createPage();
const params = new URLSearchParams(location.search);
const argv = params.getAll('arg');
if (params.has('verbose')) argv.push('-v');

launchGame({
  container: document.getElementById('container')!,
  canvas: document.getElementById('game') as HTMLCanvasElement,
  overlay: document.getElementById('overlay')!,
  log,
  argv,
  autostart: params.has('autostart'),
}).then((outcome) => done({ outcome }), fail);
