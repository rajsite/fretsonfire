// Browser input for the game: keyboard, mouse, gamepads and resize, queued for Python once per frame.
import { normalizePad } from './gamepad.ts';

export type InputEvent =
  | { t: 'keydown' | 'keyup'; code: string; key: string; repeat: boolean }
  | { t: 'mousedown' | 'mouseup'; button: number; x: number; y: number }
  | { t: 'mousemove'; x: number; y: number; dx: number; dy: number }
  | { t: 'joybutton'; joy: number; button: number; down: boolean }
  | { t: 'joyaxis'; joy: number; axis: number; value: number }
  | { t: 'joyhat'; joy: number; hat: number; x: number; y: number }
  | { t: 'resize'; width: number; height: number };

// Keys whose browser default (reload, help, find, scrolling, focus moves) would disrupt play.
const PASSTHROUGH = new Set(['F12']);

interface PadState {
  profile: string | null;
  buttons: boolean[];
  axes: number[];
  hats: [number, number][];
  povAxes: Set<number>;
}

// Gamepads only offer snapshots; polling between frames catches strums shorter than a frame.
const PAD_POLL_MS = 4;

export interface InputOptions {
  onFullscreenToggle?: () => void;
}

// Extra event producers, such as the on-screen touch frets, drained with the rest once per frame.
export interface InputSource {
  drain(now: number): InputEvent[];
}

export class BrowserInput {
  private queue: InputEvent[] = [];
  private pads = new Map<number, PadState>();
  private padTimer: ReturnType<typeof setInterval> | null = null;
  private lastMouse: [number, number] | null = null;
  private sources: InputSource[] = [];
  // Codes that are down; Android Chrome sends auto-repeat keydowns with repeat=false.
  private held = new Set<string>();
  keyRepeat = false;
  cursorVisible = true;
  prevented = 0;

  constructor(readonly canvas: HTMLCanvasElement, private options: InputOptions = {}) {
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
    addEventListener('keydown', (e) => this.onKey(e, 'keydown'), { capture: true });
    addEventListener('keyup', (e) => this.onKey(e, 'keyup'), { capture: true });
    addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => {
      canvas.focus();
      this.push({ t: 'mousedown', button: e.button + 1, ...this.pos(e) });
    });
    addEventListener('mouseup', (e) => this.push({ t: 'mouseup', button: e.button + 1, ...this.pos(e) }));
    canvas.addEventListener('mousemove', (e) => {
      const p = this.pos(e);
      const last = this.lastMouse ?? [p.x, p.y];
      this.lastMouse = [p.x, p.y];
      this.push({ t: 'mousemove', x: p.x, y: p.y, dx: p.x - last[0], dy: p.y - last[1] });
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('gamepadconnected', () => this.startPadPolling());
  }

  private startPadPolling(): void {
    this.padTimer ??= setInterval(() => this.pollGamepads(), PAD_POLL_MS);
  }

  private push(e: InputEvent): void {
    this.queue.push(e);
  }

  private pos(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) * this.canvas.width) / r.width),
      y: Math.round(((e.clientY - r.top) * this.canvas.height) / r.height),
    };
  }

  private onKey(e: KeyboardEvent, t: 'keydown' | 'keyup'): void {
    // Soft keyboards report composition keys without a code; the game has no use for them.
    if (!e.code) return;
    const wasHeld = this.held.has(e.code);
    if (t === 'keyup') this.held.delete(e.code);
    // A key the game saw go down always gets its keyup, even with a modifier pressed meanwhile.
    if ((e.ctrlKey || e.metaKey || PASSTHROUGH.has(e.code)) && !(t === 'keyup' && wasHeld)) return;
    if (t === 'keydown' && e.altKey && e.code === 'Enter') {
      e.preventDefault();
      this.options.onFullscreenToggle?.();
      return;
    }
    e.preventDefault();
    this.prevented++;
    const repeat = t === 'keydown' && (e.repeat || wasHeld);
    if (t === 'keydown') this.held.add(e.code);
    if (repeat && !this.keyRepeat) return;
    this.push({ t, code: e.code, key: e.key.length === 1 ? e.key : '', repeat });
  }

  // Keys released while the page is not focused never send keyup.
  private releaseAll(): void {
    for (const code of this.held) this.push({ t: 'keyup', code, key: '', repeat: false });
    this.held.clear();
  }

  addSource(source: InputSource): void {
    this.sources.push(source);
  }

  resized(width: number, height: number): void {
    this.push({ t: 'resize', width, height });
  }

  setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible;
    this.canvas.style.cursor = visible ? '' : 'none';
  }

  private pollGamepads(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      this.startPadPolling();
      let state = this.pads.get(pad.index);
      const povAxes = state?.povAxes ?? new Set<number>();
      const next = normalizePad(pad, povAxes);
      if (!state) {
        state = {
          profile: next.profile,
          buttons: next.buttons.map(() => false),
          axes: next.axes.map(() => 0),
          hats: next.hats.map(() => [0, 0] as [number, number]),
          povAxes,
        };
        this.pads.set(pad.index, state);
      }
      next.buttons.forEach((down, i) => {
        if (down !== !!state.buttons[i]) {
          state.buttons[i] = down;
          this.push({ t: 'joybutton', joy: pad.index, button: i, down });
        }
      });
      next.axes.forEach((v, i) => {
        if (Math.abs(v - (state.axes[i] ?? 0)) > 0.01) {
          state.axes[i] = v;
          this.push({ t: 'joyaxis', joy: pad.index, axis: i, value: v });
        }
      });
      next.hats.forEach(([x, y], i) => {
        const [px, py] = state.hats[i] ?? [0, 0];
        if (x !== px || y !== py) {
          state.hats[i] = [x, y];
          this.push({ t: 'joyhat', joy: pad.index, hat: i, x, y });
        }
      });
    }
  }

  joystickInfo(): { index: number; profile: string | null; buttons: number; axes: number; hats: number }[] {
    return [...this.pads.entries()].map(([index, s]) => ({
      index,
      profile: s.profile,
      buttons: s.buttons.length,
      axes: s.axes.length,
      hats: s.hats.length,
    }));
  }

  // Called by Python once per frame.
  drain(): InputEvent[] {
    this.pollGamepads();
    const now = performance.now();
    for (const source of this.sources) this.queue.push(...source.drain(now));
    const events = this.queue;
    this.queue = [];
    return events;
  }
}
