import { createPage } from '../page.ts';

type PadEvent =
  | { t: number; type: 'connected'; index: number; id: string; info: PadInfo; state: PadState }
  | { t: number; type: 'disconnected'; index: number; id: string }
  | { t: number; type: 'button'; index: number; ts: number; button: number; pressed: boolean; touched: boolean; value: number }
  | { t: number; type: 'axis'; index: number; ts: number; axis: number; value: number; prev: number };

interface PadInfo {
  id: string;
  mapping: string;
  axes: number;
  buttons: number;
  vibration: string | null;
}

interface PadState {
  ts: number;
  buttons: [pressed: boolean, touched: boolean, value: number][];
  axes: number[];
}

const { log, fail } = createPage();

const recordBtn = document.getElementById('record') as HTMLButtonElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const epsilonInput = document.getElementById('epsilon') as HTMLInputElement;
const snapshotsInput = document.getElementById('snapshots') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const padsEl = document.getElementById('pads')!;
const logEl = document.getElementById('log')!;

const MAX_LOG_LINES = 300;
const pads = new Map<number, PadInfo>();
const last = new Map<number, PadState>();
let events: PadEvent[] = [];
let snapshots: { t: number; pads: (PadState & { index: number })[] }[] = [];
let recording = false;
let startedAt = 0;
let startedAtIso = '';

const now = () => performance.now() - startedAt;
const round = (v: number) => Math.round(v * 1e6) / 1e6;

function infoOf(gp: Gamepad): PadInfo {
  return {
    id: gp.id,
    mapping: gp.mapping,
    axes: gp.axes.length,
    buttons: gp.buttons.length,
    vibration: gp.vibrationActuator?.type ?? null,
  };
}

function stateOf(gp: Gamepad): PadState {
  return {
    ts: round(gp.timestamp),
    buttons: gp.buttons.map((b) => [b.pressed, b.touched, round(b.value)]),
    axes: gp.axes.map(round),
  };
}

function push(ev: PadEvent): void {
  if (recording) events.push(ev);
  let text: string;
  switch (ev.type) {
    case 'connected':
      text = `#${ev.index} connected "${ev.id}" mapping=${ev.info.mapping || '(none)'} buttons=${ev.info.buttons} axes=${ev.info.axes}`;
      break;
    case 'disconnected':
      text = `#${ev.index} disconnected "${ev.id}"`;
      break;
    case 'button':
      text = `#${ev.index} button ${ev.button} ${ev.pressed ? 'down' : 'up'} value=${ev.value}${ev.touched ? ' touched' : ''}`;
      break;
    case 'axis':
      text = `#${ev.index} axis ${ev.axis} ${ev.prev} -> ${ev.value}`;
      break;
  }
  log(`${ev.t.toFixed(1).padStart(9)} ${text}`);
  while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild!.remove();
}

function connect(gp: Gamepad): void {
  const info = infoOf(gp);
  const state = stateOf(gp);
  pads.set(gp.index, info);
  last.set(gp.index, state);
  push({ t: now(), type: 'connected', index: gp.index, id: gp.id, info, state });
}

function poll(): void {
  const t = now();
  const eps = Math.max(0, Number(epsilonInput.value) || 0);
  const seen = new Set<number>();
  const frame: (PadState & { index: number })[] = [];

  for (const gp of navigator.getGamepads()) {
    if (!gp || !gp.connected) continue;
    seen.add(gp.index);
    const prev = last.get(gp.index);
    if (!prev || pads.get(gp.index)?.id !== gp.id) {
      connect(gp);
      continue;
    }
    const cur = stateOf(gp);
    cur.buttons.forEach(([pressed, touched, value], i) => {
      const [pp, pt, pv] = prev.buttons[i] ?? [false, false, 0];
      if (pressed !== pp || touched !== pt || value !== pv) {
        push({ t, type: 'button', index: gp.index, ts: cur.ts, button: i, pressed, touched, value });
      }
    });
    cur.axes.forEach((value, i) => {
      const pv = prev.axes[i] ?? 0;
      if (value !== pv && Math.abs(value - pv) > eps) {
        push({ t, type: 'axis', index: gp.index, ts: cur.ts, axis: i, value, prev: pv });
      } else {
        cur.axes[i] = pv;
      }
    });
    last.set(gp.index, cur);
    if (recording && snapshotsInput.checked) frame.push({ index: gp.index, ...stateOf(gp) });
  }

  for (const index of [...pads.keys()]) {
    if (!seen.has(index)) {
      push({ t, type: 'disconnected', index, id: pads.get(index)!.id });
      pads.delete(index);
      last.delete(index);
    }
  }

  if (frame.length) snapshots.push({ t, pads: frame });
  render();
  requestAnimationFrame(poll);
}

function render(): void {
  const html: string[] = [];
  for (const [index, info] of pads) {
    const s = last.get(index)!;
    const buttons = s.buttons
      .map(([p, , v], i) => `<span class="cell${p ? ' on' : ''}">B${i} ${v.toFixed(2)}</span>`)
      .join('');
    const axes = s.axes.map((v, i) => `<span class="cell">A${i} ${v.toFixed(3)}</span>`).join('');
    html.push(
      `<div class="pad"><div>#${index} ${escapeHtml(info.id)} &mdash; mapping=${escapeHtml(info.mapping) || '(none)'}</div>` +
        `<div class="cells">${buttons}</div><div class="cells">${axes}</div></div>`,
    );
  }
  padsEl.innerHTML = html.join('') || '<p>No gamepads detected. Press a button on the controller.</p>';
  statusEl.textContent = `${recording ? 'recording' : 'idle'} - ${events.length} events${snapshots.length ? `, ${snapshots.length} snapshots` : ''}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function recordingJson(): string {
  return JSON.stringify(
    {
      userAgent: navigator.userAgent,
      startedAt: startedAtIso,
      durationMs: round(now()),
      axisEpsilon: Number(epsilonInput.value) || 0,
      gamepads: Object.fromEntries(pads),
      events,
      ...(snapshots.length ? { snapshots } : {}),
    },
    null,
    1,
  );
}

function clear(): void {
  events = [];
  snapshots = [];
  startedAt = performance.now();
  startedAtIso = new Date().toISOString();
  logEl.replaceChildren();
  // Re-emit connected events so each recording starts with the current pad state.
  pads.clear();
  last.clear();
}

recordBtn.addEventListener('click', () => {
  recording = !recording;
  if (recording) clear();
  recordBtn.textContent = recording ? 'Stop recording' : 'Start recording';
});
clearBtn.addEventListener('click', clear);
downloadBtn.addEventListener('click', () => {
  const blob = new Blob([recordingJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gamepad-${startedAtIso.replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(recordingJson()).then(() => log('copied to clipboard'), fail);
});

window.addEventListener('gamepadconnected', (e) => log(`gamepadconnected event #${e.gamepad.index}`));
window.addEventListener('gamepaddisconnected', (e) => log(`gamepaddisconnected event #${e.gamepad.index}`));

declare global {
  interface Window {
    __gamepadRecording: () => unknown;
  }
}
window.__gamepadRecording = () => JSON.parse(recordingJson());

clear();
requestAnimationFrame(poll);
