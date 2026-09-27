# Frets on Fire → Pyodide: Implementation Plan

This plan builds on [analysis.md](analysis.md). Each step produces one or more HTML
pages under `app/` that exercise a single layer in isolation. Each step also has a
Playwright spec that must pass before the next step starts. The final step is the
full game at `app/index.html`.

JSPI is a hard requirement (Chromium today; other browsers as they ship it). Every
page checks `pyodide.ffi.can_run_sync()` at boot and shows a clear message when JSPI
is missing.

---

## 0. Target layout

```
app/
  package.json            # scripts: dev, build, preview, test
  vite.config.mjs         # multi-page inputs + fof-assets plugin
  playwright.config.mjs
  docs/                   # analysis.md, implementation-plan.md
  pages/                  # iterative test pages (step N → pages/NN-*.html)
    01-boot.html
    02-jspi-loop.html
    03-fs.html
    04-gl-shim.html
    05-font.html
    06-input.html
    07-audio.html
    08-engine.html
    09-game.html
  index.html              # final game entry (step 10)
  src/                    # browser JS (ES modules)
    boot.js               # loadPyodide, JSPI check, packages, FS mount, run python
    fs.js                 # manifest fetch → MEMFS, lazy stubs, IDBFS mount/sync
    frame.js              # nextFrame() promise (rAF), frame timing stats
    gl/backend.js         # WebGL2 executor: shader, buffers, textures, command stream
    gl/shaders.js         # uber-shader source (fixed-function subset)
    input.js              # keyboard/mouse/gamepad → event queue, preventDefault policy
    audio.js              # Web Audio engine: buffers, tracks, channels, clock
    ui.js                 # start gate (user gesture), overlays, fullscreen button
  python/                 # browser-only Python, mounted at /game/app-python (first on sys.path)
    OpenGL/__init__.py
    OpenGL/GL/__init__.py          # fixed-function emulation front-end
    OpenGL/GL/ARB/multisample.py
    OpenGL/GLU.py
    fof_web/__init__.py
    fof_web/frame.py               # flip(): gl flush + run_sync(nextFrame())
    fof_web/audio.py               # Web Audio wrapper implementing Audio.py API
    fof_web/input.py               # JS queue → pygame-shaped events
    fof_web/loopback.py            # in-memory Network transport
    fof_web/fs.py                  # materialize(), persist() (syncfs)
    fof_web/main.py                # browser entry replacing FretsOnFire.__main__
  tests/                  # Playwright specs, one per page
  pyodide/                # (existing) full distribution, served in dev, trimmed in build
```

The game code stays in `../src` and the assets in `../data`. The Vite plugin exposes
them at `/game/src/**` and `/game/data/**`.

---

## Step 1: Tooling and Pyodide boot (`pages/01-boot.html`)

**Goal:** load Pyodide from the local distribution, load the three needed wheels,
and prove JSPI works.

1. `package.json`:
   - Set `"type": "module"`.
   - Add the scripts `dev: vite`, `build: vite build`, `preview: vite preview` and `test: playwright test`.
   - Add the devDependency `@playwright/test@^1.63.0` (only `playwright` is installed now). Run `npx playwright install chromium`.
2. `vite.config.mjs`:
   - Set `root: '.'`. Add every `pages/*.html` and `index.html` to `build.rolldownOptions.input` (Vite 8; `rollupOptions` is the deprecated alias).
   - Add the custom plugin `fof-assets`:
     - **Dev:** middleware that serves `/pyodide/*` from `app/pyodide`, `/game/src/*` from `../src`, `/game/data/*` from `../data`, and `/game/app-python/*` from `app/python`. Set the right MIME types: `.wasm` → `application/wasm`, `.mjs` → JS, `.whl`/`.zip` → octet-stream.
     - **Dev and build:** generate `/game/manifest.json` (see step 3).
     - **Build:** copy only the required Pyodide files (`pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`, and the `numpy`, `pillow` and `pygame_ce` wheels) plus the trimmed game files into `dist/`.
   - Keep Vite from trying to bundle `pyodide.mjs`: load it with `import(/* @vite-ignore */ '/pyodide/pyodide.mjs')`.
3. `src/boot.js`:
   - `loadPyodide({ indexURL: '/pyodide/' })`, then `loadPackage(['numpy', 'pillow', 'pygame-ce'])`.
   - Then `runPythonAsync` a check that imports numpy, PIL and pygame, prints their versions, and returns `pyodide.ffi.can_run_sync()`.
4. `01-boot.html` shows the versions and a JSPI status, and sets `window.__result`.
5. `playwright.config.mjs`:
   - Use `webServer: npm run dev`, Chromium project only for now, and launch args `--autoplay-policy=no-user-gesture-required`.
   - Allow longer timeouts, because first wasm compile is slow.
6. `tests/01-boot.spec.mjs` asserts Python 3.14, numpy 2.4.6, Pillow 12.2.0, pygame-ce 2.5.7 and `can_run_sync === true`.

**Exit criteria:** `npm test` passes, and the page loads in about 2 s from cache.

---

## Step 2: JSPI frame loop (`pages/02-jspi-loop.html`)

**Goal:** confirm that the blocking-loop design (analysis §2.8) works before touching
game code.

1. `src/frame.js` exports `nextFrame()`, which returns a Promise that resolves on the next `requestAnimationFrame` with the timestamp.
2. `python/fof_web/frame.py`:
   - `flip()` calls `gl_flush()` (a no-op for now), then `run_sync(js.nextFrame())`.
   - `ticks()` returns `time.perf_counter()` in ms.
3. The test Python program has an outer `while True:` loop that draws a counter into the DOM and calls `flip()`. On frame 30 it enters a **nested** blocking loop (a simulated `_runDialog`) for 30 frames, then returns to the outer loop. It also calls `run_sync(fetch(...))` from inside a nested call stack to model a lazy file load.
4. Measure the frame interval jitter and confirm the page stays responsive (a button click handler runs during the loop).
5. The spec checks that the frame count advances past 90, the nested loop completed, the click was handled during the loop, and the average frame time is under 20 ms.

**Exit criteria:** the nested blocking loops run at rAF rate without freezing the tab.

---

## Step 3: Python 3 port of the game, plus a desktop reference (no page; gated by unit tests)

**Goal:** make `src/` valid, working Python 3 **before** any browser adaptation, so
port bugs and browser bugs never mix.

1. Mechanical pass with CPython 3.12 (`python3.12 -m lib2to3 -w -n src`) or `fissix`. Commit this as a separate commit.
2. Manual fixes, per analysis §2.9:
   - **Bytes/str:** `midi/*` (read `notes.mid` as bytes, `readBew`/`readVar` on bytes, `MidiOutFile` writes bytes), `Network`/`Session` (packet bytes), `Cerealizer`, the `Texture`/`Font` byte buffers.
   - **Integer division:** audit every `/` in files without `__future__.division`.
   - **Sorting:** `cmp`, `__cmp__` and `sort(lambda...)`.
   - **Config:** `ConfigParser` → `RawConfigParser`, and write with the `iso-8859-1` encoding.
   - **Hashing:** `sha.sha` → `hashlib.sha1(... .encode("latin-1"))`, keeping existing high-score hashes valid.
   - **Pillow and pygame-ce:** `tostring`/`fromstring` → `tobytes`/`frombytes`, and `Image.Transpose`.
   - Delete the codec-hijack block in `FretsOnFire.py`.
   - Re-indent `Collada.py` (tabs).
   - `gettext` without `.decode`.
3. **Desktop reference.** Create a CPython 3.12+ venv with `pygame-ce`, `PyOpenGL`, `numpy` and `pillow`, then run `cd src; python FretsOnFire.py`. Play the tutorial and one song start to finish, and fix whatever breaks. **Record reference screenshots** of the main menu, the song chooser, a gameplay frame at a fixed song position, and the results screen. Step 4 uses these as golden images.
4. **Unit tests.** Get `ObjectTest`, `SongTest` (MIDI parse and high-score round-trip), `TimerTest`, `ResourceTest` and `NetworkTest` passing on desktop py3. Also run the non-GL ones inside Pyodide under Node via `app/pyodide/python` (the Pyodide CLI runner). That checks the port on the real 3.14 wasm runtime early.
5. **Translations.** Add a build step that compiles `data/translations/*.po` → `*.mo`. This can be a Node script that implements msgfmt (a simple format) or `Tools/i18n/msgfmt.py` on desktop. Output goes to `data/translations/*.mo`, or is generated by the Vite plugin.

**Exit criteria:** the desktop game is fully playable on Python 3, and the unit tests pass on desktop and on Pyodide-in-Node.

---

## Step 4: Filesystem and assets (`pages/03-fs.html`)

**Goal:** the game's file layout exists in MEMFS, and writes persist.

1. **Manifest** (generated by the Vite plugin from `../src`, `../data` and `app/python`):
   - `{ path, size, class }` entries, where `class` is `core`, `lazy` or `excluded`.
   - `core`: all `src/**/*.py`, `data/**/*.{png,ttf,dae,ini,txt,mid,mo}`, `data/*.ogg` (SFX + menu, about 1.5 MB), `data/songs/**/{song.ini,notes.mid,label.png,script.txt,*.png}`, and `data/mods/**` (png/ini).
   - `lazy`: `data/songs/**/{song,guitar,rhythm}.ogg`.
   - `excluded`: the files listed in analysis §2.7.
2. `src/fs.js`:
   - Fetch all `core` files in parallel (HTTP/2, a bounded concurrency of about 16) and write them with `FS.writeFile` under `/game/...`.
   - Create zero-length stubs for `lazy` files and register `path → URL`.
   - `mkdirTree('/home/pyodide/.fretsonfire')`, `FS.mount(IDBFS, {}, ...)`, then `syncfs(true)` to populate.
   - Export `persist()` (`syncfs(false)`, debounced) and hook it to `pagehide`/`visibilitychange`.
   - Show loading progress.
   - An optional later optimization bundles `core` as a single `.tar.gz` and uses `pyodide.unpackArchive`.
3. `python/fof_web/fs.py`:
   - `materialize(path)` fetches a lazy file's bytes into MEMFS via `run_sync`.
   - `url_for(path)` returns the registered URL.
   - `persist()` calls `js.fofPersist()`.
4. The test page runs Python that sets `cwd=/game/src` and `sys.path=[/game/app-python, /game/src]`, then:
   - Imports `Version`, `Config`, `Song` and `midi`.
   - Calls `Song.getAvailableSongs` on a minimal fake engine with only `resource`.
   - Parses `notes.mid` for every song and prints the difficulties.
   - Writes `fretsonfire.ini`, reloads the page, and verifies the value persisted.
5. The spec asserts the 4 songs are listed with their difficulties, the persisted config survives a reload, and no lazy OGG was fetched.

---

## Step 5: OpenGL fixed-function shim (`pages/04-gl-shim.html`)

This is the largest step. Build it in sub-steps, each with a scene on the test page and
a Playwright screenshot assertion (`toHaveScreenshot` with `maxDiffPixelRatio` of
about 0.01, because SwiftShader and GPU output differ slightly).

**5a. Backend skeleton (`src/gl/backend.js`)**

- Create a WebGL2 context on `<canvas id="game">` with `{ antialias: true, alpha: false, depth: true, stencil: true, preserveDrawingBuffer: false }`.
- Use one uber-shader program. Uniforms:
  - `uMVP`, `uNormalMatrix`, `uTexMatrix`
  - `uUseTexture`, `uTexFormat` (rgba, rgb, luminance, intensity)
  - `uUseVertexColor`, `uCurrentColor`
  - `uLighting`, `uLights[8]`, `uColorMaterial`, `uMaterial`, `uNormalize`
- Attributes are position(3), color(4), texcoord(2) and normal(3). Missing attributes use constant vertex attributes (`vertexAttrib4f`), not buffers.
- A command stream API, `executeFrame(f32Arena, u32Commands)`. Command set:
  - `SET_STATE` (enable bits, blend func, depth mask, viewport, scissor)
  - `SET_UNIFORMS` (index into the arena)
  - `BIND_TEX`
  - `DRAW` (mode, first, count, attribute layout)
  - `DRAW_STATIC` (VBO id)
  - `CLEAR`
- Immediate calls (not batched) are `createTexture`, `texImage2D` (bytes), `texSubImage2D`, `texParameter`, `generateMipmap`, `deleteTexture`, `createStaticVBO`, and `deleteVBO`.

**5b. Python front-end (`python/OpenGL/GL/__init__.py`, `GLU.py`)**

- Export every constant listed in analysis §2.1, with real GL enum values so that stored config values and `glGetIntegerv` stay sane.
- **State mirror:** enable flags, blend func, depth mask, viewport, scissor, current color, texcoord and normal, bound texture, texture parameters, lights, material, and 3 matrix stacks (MODELVIEW, PROJECTION, TEXTURE; depth 32).
- **Matrices:** column-major 4×4. Start with small pure-Python tuples. Benchmark against numpy in 5f and keep the faster one. `glOrtho`, `gluPerspective` and `gluLookAt` use the standard formulas.
- **Immediate mode:** `glBegin` starts a vertex list. `glVertex*` snapshots the current color, texcoord and normal and appends to a Python list (or `array('f')`). `glEnd` triangulates QUADS (0,1,2 / 0,2,3) and POLYGON (fan), then emits a `DRAW` into the frame arena with the current state snapshot.
- **Client arrays:** `glVertexPointer`/`glColorPointer`/`glTexCoordPointer` keep references to numpy arrays. `glDrawArrays` copies `[first:first+count]` into the arena with a single `memoryview` copy, converting QUADS to TRIANGLES with a cached index pattern.
- **Display lists:** `glNewList(id, GL_COMPILE)` switches to recording mode. Geometry from `glBegin`/`glEnd` inside the list is concatenated into one static VBO per list at `glEndList`. State calls (`glEnable`, `glLightfv`, `glTranslatef`, `glCallList`, ...) are recorded as Python callables. `glCallList` replays the calls in order and emits `DRAW_STATIC` for the geometry ranges.
- **Push/pop attrib:** save and restore the subsets named by the bits that are actually used.
- **Textures:**
  - `glGenTextures` allocates an id in JS.
  - `glTexImage2D`/`glTexSubImage2D` accept `bytes` or numpy, passed as a `memoryview` → `Uint8Array` subarray without an intermediate copy (`pyodide.ffi.to_js` on a buffer).
  - `gluBuild2DMipmaps` = `texImage2D` + `generateMipmap`.
  - `GL_CLAMP` → `CLAMP_TO_EDGE`.
  - `GL_INTENSITY8`/`GL_LUMINANCE` → R8 + `uTexFormat`.
  - `glTexEnvf(MODULATE)` is the only mode; also accept REPLACE.
- **Queries:** `glGetIntegerv(GL_VIEWPORT)` returns a 4-tuple (the code does arithmetic and `int()` on the elements). `glGetFloatv(GL_CURRENT_COLOR)` returns a 4-tuple. `glGetInteger(GL_MAX_TEXTURE_SIZE)` returns the real WebGL value, capped at 4096 (Font allocates an atlas of that size!). `glGetString(GL_VENDOR)` returns a WebGL string. `glGetError` returns `GL_NO_ERROR`.
- **Stubs:** the FBO EXT functions raise `NotImplementedError` (the path is disabled). `glHint` and `glShadeModel` are no-ops (smooth is the default).
- `gl_flush()` sends the frame arena and command list to `executeFrame` in **one** FFI call per frame. `Video.flip()` calls it.

**5c–5e. Test scenes** (each is a small Python render function on the test page)

| Scene | Checks |
| --- | --- |
| a | Clear color, ortho projection, colored `GL_TRIANGLES`/`TRIANGLE_STRIP`/`QUADS`/`LINE_LOOP` |
| b | PIL-loaded `data/logo.png` via the game's own `Texture` class, alpha blending, texture-matrix push/pop |
| c | `SvgDrawing.draw()` with a transform (the game's own `Svg.py` path) |
| d | Perspective + `gluLookAt` (the `Camera.py` setup), depth test, depth mask |
| e | `Mesh("note.dae").render("Mesh_001")` with Collada lights, display lists, color material and normalize. Compare against the desktop golden image from step 3 |
| f | Client arrays: the `Guitar` waveform path (TRIANGLE_STRIP from numpy) and color arrays |

**5f. Performance pass**

- Build a synthetic "gameplay-like" frame: about 60 notes with meshes, 5 strings, 20 bars, 2 text lines, and 10 stage layers.
- Measure Python time per frame. The target is **under 8 ms** on a mid-range laptop.
- Optimizations, in order:
  1. Pure-Python vs numpy matrices.
  2. `array('f')` / preallocated numpy arena with index writes instead of list appends.
  3. Caching state snapshots (dirty flags) to avoid re-emitting identical uniforms.
  4. Merging consecutive DRAWs with identical state.

**Exit criteria:** all scenes match their golden images, and the synthetic frame meets budget.

---

## Step 6: Fonts and text (`pages/05-font.html`)

1. In the browser, call `pygame.font.init()` only (never `pygame.init()`).
2. Use the game's `Font` class unchanged (after the py3 port) with `default.ttf`, `title.ttf` and `international.ttf`. It covers glyph atlas upload via `TextureAtlas`/`loadSubsurface`, custom glyphs (`Data.customizeFont` star/ball/arrow images), the outline pass (`glGetFloatv(GL_CURRENT_COLOR)`), and the string cache.
3. Verify that `pygame.font.SysFont(None, size)` works; otherwise force the `international.ttf` path on emscripten.
4. Verify `pygame.key.name(K_F1)` works without video init. If it does not, add a fallback name table in `fof_web/input.py`.
5. The spec checks screenshots of ASCII text, special glyphs, and Latin-1 and Cyrillic samples.

---

## Step 7: Input (`pages/06-input.html`)

1. `src/input.js`:
   - Listen for `keydown`/`keyup` on `window` (the canvas is focused and has a tabindex).
   - Map `KeyboardEvent.code` → pygame-ce `K_*` (SDL2 keycodes). The table covers letters, digits, F1–F15, arrows, modifiers, the numpad, Enter, Escape, Tab, Backspace, Space and punctuation.
   - Pass `unicode` from `event.key` when it is a single character.
   - Track `repeat`. When the game has disabled repeat (`set_repeat(0,0)`), drop repeated keydowns. When it is enabled, pass them through.
   - `preventDefault` for F1–F12, arrows, Space, Enter, Tab, Backspace, Escape and `/` while focused, so the browser does not scroll, reload or open help or find.
   - Mouse: map `mousemove`/`mousedown`/`mouseup` to canvas pixel coordinates (flip Y is not needed; pygame uses top-left). Use `cursor: none` when the game hides the mouse.
   - Gamepad: each frame, `navigator.getGamepads()` is diffed and turned into JOYBUTTONDOWN/UP, JOYAXISMOTION and JOYHATMOTION (from the d-pad buttons of the standard mapping). This covers USB guitar controllers.
   - `ResizeObserver` → VIDEORESIZE.
   - `beforeunload` → nothing (the game has no "quit" prompt).
   - Alt+Enter → `requestFullscreen()` **inside the handler**, followed by `navigator.keyboard.lock(['Escape'])` where supported.
2. `python/fof_web/input.py`:
   - `get_events()` drains the JS queue (one FFI call returning a flat `Int32Array` + strings) into lightweight objects with `.type`, `.key`, `.unicode`, `.pos`, `.rel`, `.button`, `.joy`, `.axis`, `.value`, `.hat` and `.size`, using the pygame event type constants.
   - Music-end events from the audio backend are injected as `pygame.USEREVENT`.
3. Game hook: in `Input.run`, on emscripten, iterate `fof_web.input.get_events()` instead of `pygame.event.get()`. `pygame.joystick` init is replaced with a Gamepad count. `pygame.key.set_repeat` goes to `fof_web.input.set_repeat`.
4. The spec uses `page.keyboard.press('F1'..'F5', 'Enter', 'Escape')` and asserts the Python-side events and that the page did not navigate or reload. Gamepad is covered by a unit test with a stubbed `navigator.getGamepads`.

---

## Step 8: Audio (`pages/07-audio.html`)

1. `src/audio.js` (Web Audio engine):
   - A single `AudioContext` created on the start gate's click (autoplay policy); `resume()` on the first gesture.
   - `load(path)` fetches from `url_for(path)` (lazy files) or reads the MEMFS bytes (core files), then `decodeAudioData`. Results are cached per path in JS, outside the wasm heap.
   - **Channels:** N `GainNode`s into a master gain. The count comes from `getChannelCount()`, at least 8.
   - **Sound:**
     - `play(loops)` creates an `AudioBufferSourceNode`. `loop = loops != 0`; `loops > 0` uses `stop()` at `duration × (loops+1)`.
     - `stop`, `setVolume` (per-sound gain) and `fadeout(ms)` (`linearRampToValueAtTime` + stop).
   - **Channel:** `play(sound)` routes through the channel gain and stops the previous source. It also supports `setVolume`, `stop` and `fadeout`.
   - **Music:** `load`, `play(loops, pos)`, `stop`, `rewind`, `pause`/`unpause`, `setVolume`, `fadeout`, `isPlaying` and `getPosition()`. `getPosition()` = `(ctx.currentTime - startTime) × 1000 + startOffset`, minus `outputLatency × 1000` when available. `onended` → music-end event.
   - **Synchronous group start.** `Song.play()` calls `music.play()`, then `guitarTrack.play()` and `rhythmTrack.play()`. Give Music/Sound starts inside the same Python frame a shared `when = ctx.currentTime + 0.05`. An `audio.beginGroup()`/`endGroup()` pair, called by the Python wrapper around `Song.play`, sets that time. Alternatively, schedule every `play()` at the next "quantum" boundary, which gives the same alignment without any changes to `Song.py`.
   - **Global pause/unpause** (`Audio.pause`) is used by `Song.pause`. Suspend all sources: record the offsets, stop them, and restart them at the offsets on unpause. `ctx.suspend()` is simpler, but it also freezes the SFX, which matches pygame's behavior, so use `ctx.suspend()`/`resume()`.
2. `python/fof_web/audio.py`:
   - Classes `Audio`, `Music`, `Channel`, `Sound` and `StreamingSound` with the exact method surface from `Audio.py`.
   - Construction calls `run_sync(js.fofAudio.load(path))`, so loading stays synchronous from the game's point of view while the UI stays alive.
   - `Audio.py` does `if sys.platform == "emscripten": from fof_web.audio import *` at the top and skips the pygame branch.
3. `Audio.pre_open`/`open` ignore frequency, bits and buffer size (Web Audio uses the device rate). They log the real `sampleRate` and `baseLatency`.
4. **Codec check.** At boot, test `decodeAudioData` on a tiny OGG. If it fails (possibly WebKit), fall back per file to decoding with `pygame.mixer.Sound(file).get_raw()` in wasm and building an `AudioBuffer` from the PCM. The build could instead ship Opus/AAC transcodes selected by `canPlayType`.
5. The test page plays `songs/tutorial/song.ogg` + `guitar.ogg` together and shows `getPosition()` live. It toggles guitar volume (simulating a missed note), pauses and resumes, fades out, and plays SFX on the last channel.
6. The spec (Chromium, autoplay flag) checks:
   - Position advances monotonically, and `|pos − wallclock| < 30 ms` over 5 s.
   - Pause freezes the position.
   - The end event fires for a short clip.
   - Optionally, an `AnalyserNode` shows the guitar gain drop.

---

## Step 9: Engine integration (`pages/08-engine.html`)

**Goal:** `GameEngine` + `MainMenu` run in the browser, and the menus, settings and
dialogs work.

Hook points in the game, all guarded by `sys.platform == "emscripten"` (browser code
lives in `app/python/fof_web`):

| File | Change |
| --- | --- |
| `Video.py` | `setMode` sizes the canvas from config or CSS, sets the viewport, and hides the cursor. `flip()` → `fof_web.frame.flip()`. `toggleFullscreen` → JS Fullscreen API (returns True). `getVideoModes` → `[canvas size]` |
| `Timer.py` | `getTime()` → `fof_web.frame.ticks() × tickrate`. `advanceFrame()` does not busy-wait; it returns `[min(diff, timestep×16)]` immediately |
| `GameEngine.py` | Skip `pygame.init()` and call `pygame.font.init()` instead. Skip the `highpriority` option |
| `Resource.py` | Cooperative loader queue instead of `Thread` (analysis §2.5). No `os.nice`. `getWritableResourcePath()` stays `~/.fretsonfire`, which is the IDBFS mount |
| `Network.py` | `Connection`/`Server`/`communicate`/`shutdown` come from `fof_web.loopback`: an in-memory paired transport with length-framed packets. `connect()` completes immediately. Non-loopback hosts raise a friendly error |
| `MainMenu.py` | Hide "Host/Join Multiplayer" and "Import Guitar Hero(tm) Songs". `quit` → overlay |
| `GameEngine.restart` / `FretsOnFire.py` | Restart = `persist()` + `location.reload()`. `fof_web/main.py` replaces the `__main__` block: it loads the config, creates the `GameEngine` and `MainMenu`, runs `while engine.run(): pass`, and on exit shows the overlay |
| `Config.set` | After writing, call `fof_web.fs.persist()` (debounced in JS) |
| `Song.SongInfo.save`, Editor saves | Same `persist()` call |
| `GameEngine` config defaults | `game.uploadscores` forced to False with the option hidden. `video.fps` defaults to 60 and is effectively "vsync" |

Additional work in this step:

1. Boot sequence for `08-engine.html` and later pages:
   1. Show the start gate ("Click to play"). It gives the user gesture that audio and fullscreen need.
   2. `loadPyodide` and the packages.
   3. `fs.mount` (core fetch plus IDBFS sync).
   4. Create the `AudioContext`.
   5. `runPythonAsync("import fof_web.main; fof_web.main.run()")`.
2. Exceptions: `GameEngine.run` already catches them and shows `Dialogs.showMessage`. Also forward tracebacks to `console.error` and to an overlay when Python dies (top-level catch in `main.run`).
3. The spec:
   - Boots to the main menu.
   - Screenshots it against the golden image.
   - Navigates the menu with arrows and Enter into **Settings**, changes a value, backs out with Escape, and verifies `fretsonfire.ini` changed in IDBFS.
   - Opens **Credits** (Credits uses `gluPerspective` and scrolling text) and exits.
   - Opens the **Song Editor → Edit Existing Song** chooser to exercise a nested `_runDialog` loop, then cancels.

---

## Step 10: Gameplay (`pages/09-game.html`, then `index.html`)

1. "Play Game":
   1. Loopback server/session.
   2. `Lobby`.
   3. `SongChoosingScene`, which runs `Dialogs.chooseSong` + `chooseItem` in nested loops inside a Task's `run`. JSPI handles this.
   4. `GuitarScene`.
   5. `GameResultsScene`: high score entry via `getText`, then saving `song.ini` to the writable dir + `persist()`.
2. When a song is chosen, `Song.loadSong` → `Audio.Music(songFile)` → the JS audio `load()` fetches the lazy OGG. Show a "Loading song…" state; the game's own `showLoadingScreen` is already displayed while loading. Prefetch the selected song's OGGs when the cursor rests on it in the chooser (optional; a JS-side `prefetch(path)`).
3. Verify gameplay-critical timing:
   - The note highway scrolls in sync with `Song.getPosition()` from Web Audio.
   - The `audio.delay` setting still offsets correctly.
   - Key press → `Guitar.startPick` uses the position at processing time. Input latency is at most 1 frame, the same as the original.
   - A long frame (for example a GC pause) does not desync, because the position comes from the audio clock.
4. Tutorial: `songs/tutorial/script.txt` drives text and picture events, so check that the picture events load PNGs.
5. Mods and themes: `Mod.init` + `theme.ini` / `mods/Chilly`, `mods/LightGraphics`. Select them in Settings, which restarts via reload.
6. Stage: `data/stage.ini` effects (beat, pick and miss triggers, blending modes).
7. The spec:
   - Uses `?autoplay=tutorial` (maps to the existing `--play` option → `MainMenu(songName=...)`).
   - Plays scripted key presses aligned to note times read from Python.
   - Asserts that the score is above 0, the results screen appears, and a high score persists after reload.
   - Also runs a 30 s soak on `defy`, checking frame time p95 under 20 ms and no audio drift above 30 ms.
8. Promote to `index.html`: the production start page with the start gate, fullscreen button, a key-binding hint (F1–F5 by default, with a suggestion to rebind), and a "JSPI required" message for unsupported browsers.

---

## Step 11: Optional features

- **Song editor save and new-song import.** `<input type=file accept=".ogg">` → write into MEMFS under the writable dir → `Importer` runs unchanged. Uses `materialize()` for `shutil.copy` of lazy files.
- **User songs.** Drag-and-drop a song folder (song.ini, notes.mid, OGGs) into the writable `songs/` dir in IDBFS. It shows up automatically, because `getAvailableSongs` scans both roots.
- **Translations.** Enable the language option once the `.mo` files are generated (step 3.5), and verify RTL (`__lefttoright__`) for Hebrew.
- **Production packaging:**
  - Bundle the `core` data as `core.tar.gz`, unpacked with `pyodide.unpackArchive`.
  - Precompile `src/` to `.pyc` (`compileall` in Pyodide-Node) to cut import time.
  - Add a service worker cache for the Pyodide runtime and the OGGs.
- **Cross-browser.** Enable the Firefox and WebKit Playwright projects once they report `can_run_sync()`, and re-run the codec check (step 8.4) on WebKit.
- **Multiplayer (out of scope).** It could reuse the loopback transport's packet API over WebSocket or WebRTC data channels.

---

## Testing strategy summary

| Layer | Where | How |
| --- | --- | --- |
| Py3 port logic (MIDI, Song, Config, Cerealizer, Object, Network loopback) | Desktop CPython + Pyodide-in-Node | `unittest` (existing `*Test.py`) |
| GL shim correctness | `04-gl-shim.html` | Playwright screenshots vs desktop PyOpenGL golden images |
| GL shim performance | `04-gl-shim.html?bench` | `performance.now()` per frame, p50/p95 exported to `window.__result` |
| Input mapping | `06-input.html` | Playwright `keyboard`/`mouse`; stubbed Gamepad |
| Audio clock and sync | `07-audio.html` | Playwright + autoplay flag; position vs wall clock |
| Engine/menus/dialogs | `08-engine.html` | Scripted navigation; IDBFS assertions |
| End-to-end gameplay | `09-game.html` / `index.html` | Scripted tutorial play; soak test |

Every page exposes `window.__result` (a JSON status) and `window.__errors` (captured
Python tracebacks), so specs can assert on them without scraping the DOM.

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| GL shim performance (Python per-vertex overhead + FFI) | Low FPS in gameplay | One FFI flush per frame, state dirty-tracking, draw merging, pure-Python matrices. Last resort: move hot Guitar render paths to numpy-vectorized geometry |
| Fixed-function lighting mismatch | Notes and keys look different | Golden images from the desktop reference; per-vertex lighting matching the GL spec formulas |
| Ogg Vorbis unsupported in some browser's `decodeAudioData` | No audio | Runtime codec check → wasm decode fallback or transcoded assets |
| Audio/visual latency differences | Timing feels off | `outputLatency` compensation; the existing `audio.delay` calibration setting |
| Reserved browser keys (F-keys, Escape) | Controls conflict | `preventDefault`, Keyboard Lock in fullscreen, suggested alternative bindings |
| JSPI availability | Browsers other than Chromium blocked | Accepted by project decision; clear detection message; re-enable browsers as they ship JSPI |
| Py2→3 bytes/str bugs in midi, Cerealizer, Network | Corrupt songs or high scores | Step 3 desktop gate + unit tests before any browser work |
| Large first download (Pyodide ≈ 10 MB + core data ≈ 5 MB) | Slow first load | Lazy song OGGs, service worker cache, a trimmed Pyodide file set in build |
