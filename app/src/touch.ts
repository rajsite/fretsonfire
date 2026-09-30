// On-screen fret buttons for touch screens. During a song a fret press also strums, so no strum control is needed,
// and a finger sliding onto another fret plays it. Events go to the game as a virtual guitar on joystick TOUCH_JOY.
import type { InputEvent, InputSource } from './input.ts';
import { GUITAR_FRETS, GUITAR_START } from './gamepad.ts';

// Bound like the real pads 0-3 in Player.gamepadBindings.
export const TOUCH_JOY = 4;
// Frets touched this close together strum once, so chords land as chords.
export const CHORD_WINDOW_MS = 30;

const STORAGE_KEY = 'fof.touchFrets';

export type NavAction = 'up' | 'down' | 'back';

// Fret and strum logic without the DOM, driven by the page's clock.
export class TouchFretState {
  private held = new Array<number>(GUITAR_FRETS).fill(0);
  // Releases that wait for the pending strum, so a quick tap still has its fret down when it strums.
  private deferred = new Array<number>(GUITAR_FRETS).fill(0);
  private strumAt: number | null = null;
  private queue: InputEvent[] = [];

  isHeld(fret: number): boolean {
    return this.held[fret] > 0;
  }

  press(fret: number, now: number, inSong: boolean): void {
    if (this.held[fret]++ === 0) this.button(fret, true);
    if (inSong) this.strumAt ??= now + CHORD_WINDOW_MS;
  }

  release(fret: number): void {
    if (this.held[fret] - this.deferred[fret] <= 0) return;
    if (this.strumAt !== null) this.deferred[fret]++;
    else this.unhold(fret);
  }

  nav(action: NavAction): void {
    if (action === 'back') {
      this.button(GUITAR_START, true);
      this.button(GUITAR_START, false);
    } else {
      this.strum(action === 'up' ? 1 : -1);
    }
  }

  releaseAll(): void {
    this.strumAt = null;
    this.deferred.fill(0);
    this.held.forEach((n, fret) => {
      if (n > 0) this.button(fret, false);
    });
    this.held.fill(0);
  }

  drain(now: number, inSong: boolean): InputEvent[] {
    if (this.strumAt !== null && now >= this.strumAt) {
      this.strumAt = null;
      if (inSong) this.strum(1);
      this.deferred.forEach((n, fret) => {
        for (let i = 0; i < n; i++) this.unhold(fret);
      });
      this.deferred.fill(0);
    }
    const events = this.queue;
    this.queue = [];
    return events;
  }

  private unhold(fret: number): void {
    if (--this.held[fret] === 0) this.button(fret, false);
  }

  private button(button: number, down: boolean): void {
    this.queue.push({ t: 'joybutton', joy: TOUCH_JOY, button, down });
  }

  private strum(y: number): void {
    this.queue.push({ t: 'joyhat', joy: TOUCH_JOY, hat: 0, x: 0, y });
    this.queue.push({ t: 'joyhat', joy: TOUCH_JOY, hat: 0, x: 0, y: 0 });
  }
}

export interface TouchFretsOptions {
  container: HTMLElement;
  inSong: () => boolean;
  lefty?: () => boolean;
  toggle?: HTMLButtonElement | null;
}

const TEMPLATE = `
  <button type="button" tabindex="-1" class="fof-touch-pause" data-nav="back">Back</button>
  <div class="fof-touch-bar">
    <div class="fof-touch-frets">${'<div class="fof-touch-fret"></div>'.repeat(GUITAR_FRETS)}</div>
    <div class="fof-touch-nav">
      <button type="button" tabindex="-1" data-nav="up" aria-label="Up">&#9650;</button>
      <button type="button" tabindex="-1" data-nav="down" aria-label="Down">&#9660;</button>
    </div>
  </div>`;

export class TouchFrets implements InputSource {
  readonly root: HTMLElement;
  private state = new TouchFretState();
  private row: HTMLElement;
  private frets: HTMLElement[];
  private pause: HTMLElement;
  private pointers = new Map<number, number>();
  private enabled: boolean;
  private active = false;
  private song = false;
  private lefty = false;

  constructor(private options: TouchFretsOptions) {
    const saved = localStorage.getItem(STORAGE_KEY);
    this.enabled = saved === null ? matchMedia('(pointer: coarse)').matches : saved === '1';

    this.root = document.createElement('div');
    this.root.className = 'fof-touch';
    this.root.innerHTML = TEMPLATE;
    this.row = this.root.querySelector('.fof-touch-frets')!;
    this.frets = [...this.row.children] as HTMLElement[];
    this.pause = this.root.querySelector('.fof-touch-pause')!;
    options.container.append(this.root);

    this.row.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.row.setPointerCapture(e.pointerId);
      const fret = this.fretAt(e.clientX);
      this.pointers.set(e.pointerId, fret);
      this.state.press(fret, performance.now(), this.song);
      this.render();
    });
    this.row.addEventListener('pointermove', (e) => {
      const from = this.pointers.get(e.pointerId);
      const to = this.fretAt(e.clientX);
      if (from === undefined || from === to) return;
      this.pointers.set(e.pointerId, to);
      this.state.release(from);
      this.state.press(to, performance.now(), this.song);
      this.render();
    });
    const lift = (e: PointerEvent) => {
      const fret = this.pointers.get(e.pointerId);
      if (fret === undefined) return;
      this.pointers.delete(e.pointerId);
      this.state.release(fret);
      this.render();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.row.addEventListener(type, lift);

    for (const button of this.root.querySelectorAll<HTMLElement>('[data-nav]')) {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.state.nav(button.dataset.nav as NavAction);
      });
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    options.toggle?.addEventListener('click', () => this.setEnabled(!this.enabled));
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    this.sync();
    this.update();
  }

  get visible(): boolean {
    return this.enabled && this.active;
  }

  // Shown only while the game runs, not over the start gate or end screen.
  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.releaseAll();
    this.update();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    if (!enabled) this.releaseAll();
    this.update();
  }

  drain(now: number): InputEvent[] {
    this.sync();
    const events = this.state.drain(now, this.song);
    if (events.length) this.render();
    return events;
  }

  private fretAt(clientX: number): number {
    const r = this.row.getBoundingClientRect();
    const i = Math.min(GUITAR_FRETS - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * GUITAR_FRETS)));
    return this.lefty ? GUITAR_FRETS - 1 - i : i;
  }

  private releaseAll(): void {
    this.pointers.clear();
    this.state.releaseAll();
    this.render();
  }

  private sync(): void {
    this.song = this.options.inSong();
    this.lefty = this.options.lefty?.() ?? false;
    this.root.classList.toggle('fof-touch-song', this.song);
    this.row.classList.toggle('fof-touch-lefty', this.lefty);
    this.pause.textContent = this.song ? 'Pause' : 'Back';
  }

  private update(): void {
    this.root.hidden = !this.visible;
    this.options.toggle?.setAttribute('aria-pressed', String(this.enabled));
  }

  private render(): void {
    this.frets.forEach((el, i) => el.classList.toggle('pressed', this.state.isHeld(i)));
  }
}
