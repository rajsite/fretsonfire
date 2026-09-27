// Web Audio engine implementing the game's Audio.py surface (sounds, channels, one music stream).
// Timing: all starts requested during one Python frame share a start time so tracks stay aligned,
// and music position comes from AudioContext.currentTime minus the output latency.
import type { LazySource } from './fs.ts';

const START_GUARD = 0.05;
const SONGS_DIR = '/game/data/songs/';
// Decoded (float32) stems of one song may use at most this much memory.
export const SONG_PCM_BUDGET = 1 << 30;

// Channels and length of an Ogg Vorbis or Opus file, from its headers and last page.
export function oggInfo(data: Uint8Array): { channels: number; seconds: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const find = (sig: string, limit: number) => {
    outer: for (let i = 0; i + sig.length <= Math.min(limit, data.length); i++) {
      for (let j = 0; j < sig.length; j++) if (data[i + j] !== sig.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  };
  let channels: number, rate: number, preSkip = 0;
  const vorbis = find('\x01vorbis', 4096);
  const opus = vorbis < 0 ? find('OpusHead', 4096) : -1;
  if (vorbis >= 0 && vorbis + 16 <= data.length) {
    channels = data[vorbis + 11];
    rate = view.getUint32(vorbis + 12, true);
  } else if (opus >= 0 && opus + 12 <= data.length) {
    channels = data[opus + 9];
    preSkip = view.getUint16(opus + 10, true);
    rate = 48000;
  } else {
    return null;
  }
  const stop = Math.max(0, data.length - 65_536 - 27);
  for (let i = data.length - 27; i >= stop; i--) {
    if (data[i] === 0x4f && data[i + 1] === 0x67 && data[i + 2] === 0x67 && data[i + 3] === 0x53 && data[i + 4] === 0) {
      const granule = Number(view.getBigInt64(i + 6, true));
      if (granule > 0 && rate > 0) return { channels, seconds: (granule - preSkip) / rate };
    }
  }
  return null;
}

// Song stems are cached per song folder; loading from another song drops the others.
function songDir(path: string): string | null {
  return path.startsWith(SONGS_DIR) ? path.slice(0, path.lastIndexOf('/')) : null;
}

interface Playback {
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  // Context time at which buffer position 0 plays (valid while playing).
  origin: number;
  loop: boolean;
  endAt: number | null;
  pausedAt: number | null;
  ended: boolean;
  onEnded?: () => void;
}

export interface AudioFiles {
  lazy(path: string): LazySource | undefined;
  readFile(path: string): Uint8Array;
}

export class WebAudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  // Compressed bytes read by tooLong(), kept for the decode that usually follows.
  private encoded = new Map<string, Uint8Array>();
  private decoded: (AudioBuffer | null)[] = [];
  private sounds = new Map<number, { buffer: AudioBuffer; volume: number; playbacks: Set<Playback> }>();
  private channels: { gain: GainNode; playback: Playback | null }[] = [];
  private music: { buffer: AudioBuffer | null; gain: GainNode; playback: Playback | null; startOffset: number; paused: boolean };
  private nextSound = 1;
  private pendingStart: number | null = null;
  private events: string[] = [];
  musicEndEvent = false;

  constructor(private files: AudioFiles, ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.music = { buffer: null, gain: this.ctx.createGain(), playback: null, startOffset: 0, paused: false };
    this.music.gain.connect(this.master);
    this.open(8);
  }

  resume(): Promise<void> {
    return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
  }

  info(): { sampleRate: number; baseLatency: number; outputLatency: number; state: string } {
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatency: this.ctx.baseLatency ?? 0,
      outputLatency: this.ctx.outputLatency ?? 0,
      state: this.ctx.state,
    };
  }

  open(channels: number): void {
    while (this.channels.length < channels) {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      this.channels.push({ gain, playback: null });
    }
  }

  channelCount(): number {
    return this.channels.length;
  }

  // --- Loading --------------------------------------------------------------

  load(path: string): Promise<number> {
    const dir = songDir(path);
    if (dir) this.evictSongsExcept(dir);
    let p = this.buffers.get(path);
    if (!p) {
      p = (async () => {
        const data = this.encoded.get(path) ?? (await this.readEncoded(path));
        this.encoded.delete(path);
        const whole = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
        const bytes = (whole ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as ArrayBuffer;
        return this.ctx.decodeAudioData(bytes);
      })();
      this.buffers.set(path, p);
      p.catch(() => this.buffers.delete(path));
    }
    return p.then((buffer) => {
      let id = this.decoded.indexOf(buffer);
      if (id < 0) id = this.decoded.push(buffer) - 1;
      return id;
    });
  }

  duration(bufferId: number): number {
    return this.decoded[bufferId]?.duration ?? 0;
  }

  private async readEncoded(path: string): Promise<Uint8Array> {
    const source = this.files.lazy(path);
    return source ? source.bytes() : this.files.readFile(path);
  }

  // Whether decoding all of these files (one song's stems) would exceed SONG_PCM_BUDGET.
  async tooLong(paths: string[]): Promise<boolean> {
    const sizes = await Promise.all(
      paths.map(async (path) => {
        const cached = this.buffers.get(path);
        if (cached) {
          const buffer = await cached;
          return buffer.length * buffer.numberOfChannels * 4;
        }
        const data = this.encoded.get(path) ?? (await this.readEncoded(path));
        this.encoded.set(path, data);
        const info = oggInfo(data);
        return info ? info.seconds * this.ctx.sampleRate * info.channels * 4 : 0;
      }),
    );
    const tooLong = sizes.reduce((a, b) => a + b, 0) > SONG_PCM_BUDGET;
    if (tooLong) for (const path of paths) this.encoded.delete(path);
    return tooLong;
  }

  prefetch(path: string): void {
    this.load(path).catch(() => {});
  }

  private evictSongsExcept(dir: string): void {
    for (const path of this.encoded.keys()) {
      const d = songDir(path);
      if (d && d !== dir) this.encoded.delete(path);
    }
    for (const [path, promise] of this.buffers) {
      const d = songDir(path);
      if (!d || d === dir) continue;
      this.buffers.delete(path);
      promise.then(
        (buffer) => {
          const id = this.decoded.indexOf(buffer);
          if (id >= 0) this.decoded[id] = null;
        },
        () => {},
      );
    }
  }

  private buffer(bufferId: number): AudioBuffer {
    const buffer = this.decoded[bufferId];
    if (!buffer) throw new Error(`audio buffer ${bufferId} was released`);
    return buffer;
  }

  stats(): { cached: string[]; sounds: number; playingSounds: number } {
    let playingSounds = 0;
    for (const s of this.sounds.values()) if ([...s.playbacks].some((pb) => this.isActive(pb))) playingSounds++;
    return { cached: [...this.buffers.keys()], sounds: this.sounds.size, playingSounds };
  }

  // --- Playback primitives ----------------------------------------------------

  private startTime(): number {
    if (this.pendingStart === null) {
      this.pendingStart = this.ctx.currentTime + START_GUARD;
      // Everything started before control returns to the event loop shares this time.
      queueMicrotask(() => (this.pendingStart = null));
    }
    return this.pendingStart;
  }

  private startSource(pb: Playback, when: number, offset: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = pb.buffer;
    src.loop = pb.loop;
    src.connect(pb.gain);
    src.onended = () => {
      if (pb.source !== src) return;
      pb.source = null;
      if (pb.pausedAt === null) {
        pb.ended = true;
        pb.onEnded?.();
      }
    };
    const duration = pb.buffer.duration;
    src.start(when, pb.loop ? offset % duration : Math.min(offset, duration));
    if (pb.endAt !== null) src.stop(when + Math.max(0, pb.endAt - offset));
    pb.source = src;
    pb.origin = when - offset;
    pb.pausedAt = null;
    pb.ended = false;
  }

  private play(buffer: AudioBuffer, output: AudioNode, loops: number, offset = 0, volume = 1): Playback {
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(output);
    const pb: Playback = {
      buffer,
      source: null,
      gain,
      origin: 0,
      loop: loops !== 0,
      endAt: loops > 0 ? buffer.duration * (loops + 1) : null,
      pausedAt: null,
      ended: false,
    };
    this.startSource(pb, this.startTime(), offset);
    return pb;
  }

  private stopPlayback(pb: Playback | null): void {
    if (!pb) return;
    pb.pausedAt = null;
    pb.ended = true;
    const src = pb.source;
    pb.source = null;
    if (src) {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    }
    pb.gain.disconnect();
  }

  private fadePlayback(pb: Playback | null, ms: number): void {
    if (!pb || !pb.source) return;
    const t = this.ctx.currentTime;
    const g = pb.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + ms / 1000);
    pb.source.stop(t + ms / 1000);
  }

  private pausePlayback(pb: Playback | null): void {
    if (!pb || !pb.source || pb.pausedAt !== null) return;
    const src = pb.source;
    pb.pausedAt = Math.max(0, this.ctx.currentTime - pb.origin);
    pb.source = null;
    src.stop();
  }

  private resumePlayback(pb: Playback | null): void {
    if (!pb || pb.pausedAt === null || pb.ended) return;
    this.startSource(pb, this.startTime(), pb.pausedAt);
  }

  private isActive(pb: Playback | null): boolean {
    return !!pb && !pb.ended && (pb.source !== null || pb.pausedAt !== null);
  }

  // --- Sounds and channels ------------------------------------------------------

  createSound(bufferId: number): number {
    const id = this.nextSound++;
    this.sounds.set(id, { buffer: this.buffer(bufferId), volume: 1, playbacks: new Set() });
    return id;
  }

  // Python dropped the sound; playbacks still running keep their buffer until they end.
  soundRelease(id: number): void {
    this.sounds.delete(id);
  }

  soundPlay(id: number, loops: number, channel: number): void {
    const s = this.sounds.get(id);
    if (!s) return;
    const ch = channel >= 0 ? this.channels[channel] : undefined;
    if (ch) this.stopPlayback(ch.playback);
    const pb = this.play(s.buffer, ch ? ch.gain : this.master, loops, 0, s.volume);
    s.playbacks.add(pb);
    pb.onEnded = () => s.playbacks.delete(pb);
    if (ch) ch.playback = pb;
  }

  soundStop(id: number): void {
    const s = this.sounds.get(id);
    if (!s) return;
    for (const pb of s.playbacks) this.stopPlayback(pb);
    s.playbacks.clear();
  }

  soundSetVolume(id: number, volume: number): void {
    const s = this.sounds.get(id);
    if (!s) return;
    s.volume = volume;
    for (const pb of s.playbacks) pb.gain.gain.setValueAtTime(volume, this.ctx.currentTime);
  }

  soundFadeout(id: number, ms: number): void {
    const s = this.sounds.get(id);
    if (!s) return;
    for (const pb of s.playbacks) this.fadePlayback(pb, ms);
  }

  channelStop(n: number): void {
    const ch = this.channels[n];
    if (!ch) return;
    this.stopPlayback(ch.playback);
    ch.playback = null;
  }

  channelSetVolume(n: number, volume: number): void {
    this.channels[n]?.gain.gain.setValueAtTime(volume, this.ctx.currentTime);
  }

  channelFadeout(n: number, ms: number): void {
    this.fadePlayback(this.channels[n]?.playback ?? null, ms);
  }

  channelBusy(n: number): boolean {
    return this.isActive(this.channels[n]?.playback ?? null);
  }

  // Global pause/unpause of everything that is currently playing (pygame.mixer.pause semantics).
  pauseAll(): void {
    for (const ch of this.channels) this.pausePlayback(ch.playback);
    for (const s of this.sounds.values()) for (const pb of s.playbacks) this.pausePlayback(pb);
    this.pausePlayback(this.music.playback);
  }

  unpauseAll(): void {
    for (const ch of this.channels) this.resumePlayback(ch.playback);
    for (const s of this.sounds.values()) for (const pb of s.playbacks) this.resumePlayback(pb);
    if (!this.music.paused) this.resumePlayback(this.music.playback);
  }

  // --- Music ----------------------------------------------------------------

  musicLoad(bufferId: number): void {
    this.musicStop();
    this.music.buffer = this.buffer(bufferId);
  }

  musicPlay(loops: number, startSeconds: number): void {
    this.musicStop();
    if (!this.music.buffer) return;
    this.music.paused = false;
    this.music.startOffset = startSeconds;
    const pb = this.play(this.music.buffer, this.music.gain, loops, startSeconds);
    pb.onEnded = () => {
      if (this.musicEndEvent) this.events.push('musicEnded');
    };
    this.music.playback = pb;
  }

  musicStop(): void {
    this.stopPlayback(this.music.playback);
    this.music.playback = null;
    this.music.paused = false;
  }

  musicRewind(): void {
    this.music.startOffset = 0;
  }

  musicPause(): void {
    this.music.paused = true;
    this.pausePlayback(this.music.playback);
  }

  musicUnpause(): void {
    this.music.paused = false;
    this.resumePlayback(this.music.playback);
  }

  musicSetVolume(volume: number): void {
    this.music.gain.gain.setValueAtTime(volume, this.ctx.currentTime);
  }

  musicFadeout(ms: number): void {
    this.fadePlayback(this.music.playback, ms);
  }

  musicIsPlaying(): boolean {
    return this.isActive(this.music.playback);
  }

  // Milliseconds played since musicPlay (pygame.mixer.music.get_pos semantics), -1 when stopped.
  musicGetPos(): number {
    const pb = this.music.playback;
    if (!pb || pb.ended) return -1;
    const bufferPos = pb.pausedAt !== null ? pb.pausedAt : this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) - pb.origin;
    return (bufferPos - this.music.startOffset) * 1000;
  }

  drainEvents(): string[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  closeAll(): void {
    this.musicStop();
    for (let i = 0; i < this.channels.length; i++) this.channelStop(i);
    for (const id of this.sounds.keys()) this.soundStop(id);
  }
}
