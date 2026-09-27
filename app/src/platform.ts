// Browser platform modules exposed to Python: fofgl (WebGL2), fofinput (DOM input), fofaudio (Web Audio).
import { GLBackend } from './gl/backend.ts';
import { BrowserInput } from './input.ts';
import { WebAudioEngine } from './audio.ts';
import type { GameRuntime } from './runtime.ts';

export interface Platform {
  gl: GLBackend;
  input: BrowserInput;
  audio: () => WebAudioEngine;
  modules: (rt: Omit<GameRuntime, 'bridge'>) => Record<string, object>;
}

export function toggleFullscreen(element: HTMLElement): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  void element.requestFullscreen().then(() => {
    const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard;
    // Lets Escape reach the game in fullscreen where the Keyboard Lock API exists (Chromium).
    void keyboard?.lock?.(['Escape']).catch(() => {});
  });
}

export function createPlatform(canvas: HTMLCanvasElement, fullscreenElement: HTMLElement = canvas, audioContext?: AudioContext): Platform {
  const gl = new GLBackend(canvas);
  const input = new BrowserInput(canvas, { onFullscreenToggle: () => toggleFullscreen(fullscreenElement) });
  let audio: WebAudioEngine | null = null;
  return {
    gl,
    input,
    audio: () => {
      if (!audio) throw new Error('Audio engine not created yet');
      return audio;
    },
    modules: (rt) => {
      audio = new WebAudioEngine(
        {
          lazyUrl: (path) => rt.files.lazy.get(path) ?? null,
          readFile: (path) => rt.pyodide.FS.readFile(path),
        },
        audioContext,
      );
      return { fofgl: gl, fofinput: input, fofaudio: audio };
    },
  };
}
