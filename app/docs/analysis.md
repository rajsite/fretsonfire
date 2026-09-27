# Frets on Fire → Pyodide: Analysis

This document records what the project is and what it depends on. It also lists
every issue that matters for running it in a browser on Pyodide. The step-by-step
plan is in [implementation-plan.md](implementation-plan.md).

## 1. Project summary

| Item | Value |
| --- | --- |
| Game | Frets on Fire 1.3 (rev 110), Unreal Voodoo, GPLv2 |
| Language | **Python 2** (2.4–2.6 era), about 20k lines in `src/` (76 files, including `src/midi/`) |
| Entry point | `src/FretsOnFire.py` → `GameEngine` + `MainMenu`, then `while engine.run(): pass` |
| Rendering | PyOpenGL, **fixed-function OpenGL 1.x** (immediate mode, display lists, matrix stack, fixed lighting) |
| Windowing / input / audio / fonts | pygame 1.x (SDL 1.2) |
| Images | PIL (`Image.open`, `tostring`/`fromstring`) |
| Math | numpy (matrices, vertex arrays) |
| Optional deps | psyco (JIT, ignored), pyglet (dead code path), PyOGG (disabled), GLEWpy (FBO path, disabled by default), `oggenc` CLI (GH importer) |
| Data | `data/`, 35 MB total, of which 27 MB is OGG (4 songs of about 8 MB each, plus SFX) |

### Target runtime (from `app/pyodide`)

| Item | Value |
| --- | --- |
| Pyodide | 314.0.7, **CPython 3.14.2**, Emscripten 5.0.3, wasm32, ABI `2026_0` |
| Available wheels we need | `numpy 2.4.6`, `pillow 12.2.0`, `pygame-ce 2.5.7` (statically linked SDL2 + SDL_image + SDL_mixer with OGG/vorbis + SDL_ttf/freetype) |
| Also available | `zengl` (WebGL2/GLES3 binding), `pyodide-http`, `micropip`, `audioop-lts` |
| **Not available** | PyOpenGL (it also has no libGL to bind to), psyco, asyncore/asynchat (removed from CPython 3.12) |
| Runtime features confirmed in `pyodide.asm.mjs` | JSPI (`WebAssembly.Suspending`/`promising`, `pyodide.ffi.run_sync`, `can_run_sync`), `IDBFS` + `syncfs`, `unpackArchive`, `setCanvas2D/3D`, WebGL/WebGL2 bindings (`GLctx`) |
| Emscripten legacy GL | **Not compiled in.** `glBegin` in the runtime is `abort("…compile with -sLEGACY_GL_EMULATION…")` |

### Tooling in `app/`

- Node 24.21, Vite 8.3.1, Playwright 1.63.0. The bundled browsers are Chromium 153, Firefox 155 and WebKit 26.6.
- `package.json` is `"type": "commonjs"` with no scripts. `@playwright/test` is **not** installed; only the `playwright` library is.
- Chromium 153 has JSPI enabled by default. Per the project decision, JSPI is used as a hard requirement.

## 2. Dependency analysis

### 2.1 PyOpenGL / fixed-function OpenGL (the largest issue)

WebGL2 has no fixed-function pipeline, and Pyodide has neither PyOpenGL nor legacy GL
emulation. Rebuilding Pyodide with `-sLEGACY_GL_EMULATION` or GL4ES is too costly.
Rewriting all render code against `zengl` would touch almost every scene file.
**The practical route is a Python `OpenGL` shim package** that implements exactly the
subset the game uses, on top of WebGL2.

The measured API surface is small (non-test sources):

- **Immediate mode:** `glBegin`/`glEnd` (19), `glVertex2f` (35), `glVertex3f` (32), `glTexCoord2f` (36), `glColor3f` (17), `glColor4f` (28), `glNormal3f` (in Mesh).
- **Primitives:** `GL_TRIANGLES`, `GL_TRIANGLE_STRIP`, `GL_QUADS` (Font), `GL_POLYGON` (Collada meshes), `GL_LINE_LOOP`.
- **Client arrays:** `glVertexPointer`, `glTexCoordPointer`, `glColorPointer`, `glEnable/DisableClientState`, `glDrawArrays` (used in Font and Guitar with numpy arrays).
- **Matrices:** `glMatrixMode` (38), `glPush/PopMatrix` (≈25 each), `glLoadIdentity`, `glTranslatef/glTranslate`, `glRotatef/glRotate`, `glScalef`, `glMultMatrixf`, `glOrtho`, `gluPerspective`, `gluLookAt`. `GL_TEXTURE` is also used as a matrix mode (push/pop only).
- **Display lists:** `glGenLists`, `glNewList(GL_COMPILE)`, `glEndList`, `glCallList` (Mesh). Lists record **state changes too**: lights, enable/disable, transforms, nested `glCallList`.
- **Lighting:** `glLightfv` (POSITION, DIFFUSE, AMBIENT), `glMaterialf/fv`, `GL_LIGHTING`, `GL_LIGHT0+n`, `GL_COLOR_MATERIAL`, `GL_NORMALIZE`, `glShadeModel(GL_SMOOTH)`.
- **State:** `glEnable/glDisable` (BLEND, DEPTH_TEST, TEXTURE_2D, CULL_FACE, LIGHTING, COLOR_MATERIAL, NORMALIZE, MULTISAMPLE), `glBlendFunc`, `glDepthMask`, `glScissor`, `glViewport`, `glClear/glClearColor`, `glHint` (no-op), `glPushAttrib/glPopAttrib` (CURRENT, ENABLE, TEXTURE, STENCIL, TRANSFORM, COLOR_BUFFER, POLYGON, DEPTH bits).
- **Textures:** `glGenTextures`, `glBindTexture`, `glTexParameteri/f`, `glTexEnvf(GL_MODULATE)`, `glTexImage2D`, `glTexSubImage2D`, `gluBuild2DMipmaps`, `glPixelStorei`, `glCopyTexSubImage2D` (emulated FBO only). Formats are RGB, RGBA, LUMINANCE and `GL_INTENSITY8`. `GL_CLAMP` is used.
- **Queries:** `glGetIntegerv(GL_VIEWPORT)` (used heavily for layout), `glGetFloatv(GL_CURRENT_COLOR)`, `glGetInteger(GL_MAX_TEXTURE_SIZE)`, `glGetString(GL_VENDOR)`, `glGetError`.
- **FBO (`glew`, `*EXT`):** only reached when `opengl.supportfbo=True` **and** GLEWpy is importable. Default is False, and `SvgDrawing.convertToTexture` has the render-to-texture code commented out. **Unused. Stub it.**
- **`OpenGL.GL.ARB.multisample`:** `GL_MULTISAMPLE_ARB`. Use the WebGL `antialias: true` context attribute instead.

Implications for the shim:

- **Python-side state mirror.** All `glGet*` queries are answered from Python state, which avoids synchronous JS round trips.
- **CPU-side conversion.** `GL_QUADS` and `GL_POLYGON` must be triangulated. `GL_LINE_LOOP` becomes `LINE_LOOP` (WebGL supports it). `GL_CLAMP` becomes `CLAMP_TO_EDGE`.
- **`GL_INTENSITY8` / `GL_LUMINANCE`** are uploaded as `R8`/`LUMINANCE`, with a shader "format" uniform that swizzles to `(i,i,i,i)` or `(l,l,l,1)`.
- **One "uber" shader** covers the fixed-function subset: vertex color or current color, optional texture with MODULATE, optional per-vertex lighting (up to 8 directional or positional lights, color-material, normalize), and an alpha channel for blending.
- **Mipmaps:** `gluBuild2DMipmaps` becomes `texImage2D` + `generateMipmap`. WebGL2 supports NPOT textures with mipmaps, so `nextPowerOfTwo` padding still works but is no longer required.
- **Display lists:** geometry is baked into static VBOs at `glEndList`. State commands are replayed through the normal front-end on `glCallList`.
- **Per-frame batching:** the original draws with many tiny `glBegin`/`glEnd` blocks, so FFI crossings must be minimized (see plan, step 5).

### 2.2 pygame → pygame-ce 2.5.7 (in Pyodide)

| Use in game | Browser status |
| --- | --- |
| `pygame.display.set_mode(OPENGL\|DOUBLEBUF)`, `gl_set_attribute`, `flip`, `toggle_fullscreen`, `list_modes`, `set_caption`, `mouse.set_visible` | **Replace.** Our WebGL2 canvas is owned by JS. `flip()` becomes a frame flush plus a JSPI yield. Fullscreen uses the Fullscreen API. |
| `pygame.event.get/pump` (KEYDOWN/UP, MOUSE*, JOY*, VIDEORESIZE, QUIT, USEREVENT for music end) | **Replace** with a JS DOM/Gamepad event queue that is converted to pygame-like event objects. SDL2 only attaches DOM listeners when a window is created, and we will not create one. |
| `pygame.key.name`, `pygame.key.set_repeat`, `K_*` constants | Constants: keep, as they are pure values. `set_repeat`: emulate in the input adapter using the browser `repeat` flag. `key.name`: verify it works without video init; otherwise add a fallback table. |
| `pygame.font.Font(ttf)`, `SysFont(None)`, `render`, `size`, `get_height`, `get_linesize`, `set_bold/italic/underline` | **Keep.** SDL_ttf is present in the wheel. `SysFont` has no fontconfig and falls back to the pygame default font, so prefer the bundled `international.ttf`. |
| `pygame.Surface(..., SRCALPHA, 32)`, `blit`, `pygame.image.tostring` | **Keep.** Use `tobytes` (`tostring` is deprecated in pygame 2). |
| `pygame.mixer` (`pre_init/init`, `Sound`, `Channel`, `music.load/play/get_pos/set_endevent/fadeout/...`) | **Replace with Web Audio** (see 2.4). pygame-ce's mixer works in Pyodide, but its timing and main-thread callbacks are not good enough for a rhythm game. |
| `pygame.time.get_ticks`, `pygame.time.wait(0)` | **Replace** with `time.perf_counter()`-based ticks. `wait(0)` is removed, as the browser loop yields per frame. |
| `pygame.joystick.*` | **Replace** with the Gamepad API, polled each frame and mapped to JOY* events. |
| `pygame.sndarray` | Only reached in the disabled `ogg.vorbis` streaming path. Unused. |
| `pygame.init()` | **Avoid in the browser.** It would initialize SDL audio (a competing AudioContext plus autoplay warnings) and video. Call `pygame.font.init()` only. |

### 2.3 PIL → Pillow 12.2

- `image.tostring(...)` → `tobytes(...)`, and `Image.fromstring` → `Image.frombytes` (Texture.py 13×, Font.py 3×).
- `Image.FLIP_TOP_BOTTOM` → `Image.Transpose.FLIP_TOP_BOTTOM`.
- `import Image` / `import PngImagePlugin` fallbacks: delete them.
- PNG decode runs in wasm libpng, which is fine for about 1.6 MB of PNGs.

### 2.4 Audio (timing-critical)

How the game uses audio:

- **Menu music:** `Audio.Sound("menu.ogg").play(-1)`, looping, with fadeout.
- **Song playback:** `Song` plays up to 3 tracks at once:
  - `Music(song.ogg)`, the background track. It is the **master clock**: `Song.getPosition()` → `music.getPosition()` → `pygame.mixer.music.get_pos()`.
  - `StreamingSound(guitar.ogg)` on channel 1. Its volume is dropped to near-silent on a missed note (`setGuitarVolume`).
  - `StreamingSound(rhythm.ogg)` on channel 2, optional.
- **SFX:** fiba1-6 (screw-ups) on the last channel, plus in/out/crunch/start/perfect/jurgen/myhero. `Channel.setVolume` is used.
- **Controls used:** `pause/unpause` (global), `stop`, `rewind`, `fadeout(ms)`, `isPlaying`, and `setEndEvent(USEREVENT)`. `Input` translates that event to `musicFinished`.
- **Settings:** `frequency`, `bits`, `stereo`, `buffersize`, and `delay` (A/V delay in ms, used to offset notes).

Browser concerns:

1. **Sync.** Three tracks must start sample-aligned and stay aligned. Web Audio `AudioBufferSourceNode.start(when)` on one `AudioContext` gives exact alignment. SDL's mixer does not guarantee this for `music` vs `Sound` channels.
2. **Clock.** `AudioContext.currentTime` (minus `outputLatency`) gives a precise, monotonic song position. SDL2-emscripten's `get_pos` counts mixed samples on a main-thread ScriptProcessor callback, so it drifts and stutters when Python frames are long.
3. **Decoding.** `decodeAudioData` is native and off-main-thread, which matters for 4 MB OGGs. pygame-ce would decode about 37 MB of PCM per track in wasm, blocking the UI for seconds.
4. **Autoplay policy.** The `AudioContext` needs a user gesture, so the page needs a "click to start" gate.
5. **Codec support.** Ogg Vorbis `decodeAudioData` works in Chromium and Firefox. Safari/WebKit support needs checking (see plan, step 8). The fallback is to transcode at build time or to decode with pygame-ce in wasm.

**Decision:** keep the game's `Audio.py` API (Audio/Music/Channel/Sound/StreamingSound). On `sys.platform == "emscripten"`, implement it with a Web Audio backend in JS through a thin Python wrapper.

### 2.5 Threads

- `Resource.Loader(Thread)` runs every asynchronous resource load: fonts, sounds, meshes, songs, and the session connect. `loader()` joins. It uses `os.nice(5)` on posix.
- `Texture.cleanupQueue` and `Queue` are only used for cross-thread GL deletion.
- `Debug.py` calls `threading.activeCount()`.
- **Pyodide cannot start threads** (`Thread.start()` → `RuntimeError`).

**Decision:** on emscripten, `Resource.load(synch=False)` queues the loader. `Resource.run()` executes one queued loader per frame (cooperatively), then calls `finish()`. This keeps the "attribute is `None` until loaded, then `onLoad` fires" semantics that `Data.essentialResourcesLoaded` and the loading screens rely on. `Loader.__call__` runs the loader immediately if it is still pending.

### 2.6 Networking (single-player depends on it)

`MainMenu.newSinglePlayerGame` and `showTutorial` start a `Server` and a `ClientSession`, which talk over a **TCP loopback socket on port 12345** using `asyncore`. Messages are pickled `Message` objects with a `Phrasebook`, and `World` and the scenes are replicated this way. Problems:

- `asyncore`/`asynchat` do not exist in Python 3.12+ (confirmed missing from `python_stdlib.zip`).
- Browsers have no raw sockets. Pyodide's `socket` module cannot listen or accept.
- `Connection.connect` does a blocking busy-wait with `time.sleep(.1)`.

**Decision:** add an in-process loopback transport with the same `Network.Connection`/`Network.Server`/`communicate()` API. A connection to `127.0.0.1`/`localhost` creates a paired in-memory connection, and packets go through deques. Keep the pickle and phrasebook path so the World/Scene code is untouched. Remove "Host/Join Multiplayer" from the browser menu. Real multiplayer over WebSocket or WebRTC is out of scope.

### 2.7 Filesystem and persistence

- **Read-only data:** `Version.dataPath()` → `../data` relative to the CWD `src`. In the browser, use the Emscripten MEMFS layout `/game/src` (cwd) and `/game/data`.
- **Writable path:** `Resource.getWritableResourcePath()` → `~/.fretsonfire` (posix). This holds `fretsonfire.ini`, `fretsonfire.log`, per-song `song.ini` copies with high scores, and editor output. Mount **IDBFS** there and `syncfs` after writes (config set, high score save, editor save) and on `pagehide`.
- `os.nice`, `os.chmod`, `os.access`, `shutil.copy`, `os.makedirs`, `os.listdir`, `glob`: all work on MEMFS.
- **Directory scanning:** `Song.getAvailableSongs`, `getAvailableLibraries`, `Mod.init` and `Language.getAvailableLanguages` scan directories, so directory structure and small files must exist in MEMFS **before** use.
- **Lazy loading:** the big song OGGs (26 MB) should be fetched lazily. `loadSong` only checks `os.path.isfile(...)` for them, and with the Web Audio backend the bytes never need to be in MEMFS. Write zero-length **stub files** plus a path→URL registry, and add a `materialize(path)` helper for code that really copies files (Editor `createSong`/importer).
- **Files to exclude from the browser data set:** `win32/` (DLLs, EXE, NSIS), `*.3DS`, `*.svg` (every one used has a `.png` twin; SVGs are only loaded when no PNG exists), `*.pyc`, `*.sh`, `Makefile`, `icon*.ico/icns`, and the `.po` sources (which get compiled, see 2.9).

### 2.8 The main loop, blocking loops and JSPI

Blocking loops that must keep working:

- `FretsOnFire.py`: `while engine.run(): pass`.
- `Timer.advanceFrame()`: a **busy-wait** until `timestep` (1000/fps ms) has elapsed.
- `Dialogs._runDialog`: nested modal loops `while dialog in view.layers: engine.run()`. These back `getText`, `getKey`, `chooseSong`, `chooseFile`, `chooseItem`, `testKeys`, `showLoadingScreen`, `showMessage` and `estimateBpm`. They are called from menu callbacks, `SongChoosingScene.run` (inside a Task's `run`!), the Editor, Settings, and the exception handler in `GameEngine.run`.
- `Network.Connection.connect`: a busy-wait with `time.sleep`.

**Decision (JSPI):** keep all of these loops as-is. Every rendered frame, including frames in nested dialog loops, ends in `Video.flip()`. The browser `flip()` flushes GL and then calls `pyodide.ffi.run_sync(nextAnimationFrame())`, which suspends the wasm stack until the next `requestAnimationFrame`. That single yield point makes every loop in the game browser-safe without restructuring into async code. Other waits:

- `Timer.advanceFrame` must stop spinning. The browser version returns immediately with the elapsed ticks, and pacing comes from rAF.
- `time.sleep` in `Network` goes away with the loopback transport.
- Long synchronous loads (song audio decode, fetching lazy files) use `run_sync(promise)`. The UI stays alive and the code stays synchronous.

JSPI requirements:

- Python must be entered through `pyodide.runPythonAsync()` (or `callPromising`) so the stack is suspendable.
- `can_run_sync()` must be checked at boot, with a clear message shown when JSPI is missing.
- Playwright's Chromium 153 supports JSPI. For Firefox and WebKit, detect at runtime and report "unsupported" until those browsers support it.

### 2.9 Python 2 → 3 port (mechanical but wide)

Counts from `src/`:

| Idiom | Count / files | Fix |
| --- | --- | --- |
| `print x` statements, `print >>f, x` | 79 (MidiToText 37, DataTypeConverters 16, Guitar 7, Song 5, Log 2 ...) | `print()` |
| `except X, e:` | 15 in 11 files | `except X as e:` |
| `raise E, v, tb` | Resource, EventDispatcher, MidiFileParser | `raise v.with_traceback(tb)` |
| `unicode(...)` | 19 (Data 6, Dialogs, Editor, MainMenu, Log ...) | `str` |
| `xrange` | Audio, Font | `range` |
| `has_key`, `iteritems/itervalues` | Cerealizer | `in`, `.items()` |
| `cmp`, `__cmp__`, `list.sort(lambda a,b: ...)` | Song (6 sorts), Svg, Cerealizer | `key=` / `functools.cmp_to_key` / `__eq__` + `__lt__` |
| `dict.keys()[0]`, `values()[0]` | Font, Network | `next(iter(...))` |
| `StringIO`, `cPickle`, `Queue`, `ConfigParser`, `urllib`, `sha`, `sets`, `types.StringType` | 13/15/19/7/2/2/1/3 hits | `io`, `pickle`, `queue`, `configparser` (use **`RawConfigParser`** to avoid `%` interpolation), `urllib.request/parse`, `hashlib.sha1`, `set`, `str`/`bytes` |
| `0xFFL` long literals | midi/DataTypeConverters | drop `L` |
| `type(x) == file` | Svg | `hasattr(x, "read")` |
| `reduce`, `map/filter` returning lists | Song, Editor, Session | `functools.reduce`, `list(...)` |
| Integer `/` | Many files without `from __future__ import division` (for example `Mesh._unflatten` `range(len(a)/stride)` and `Input.decodeJoystickHat` `v / 3`) | Audit each: `//` where an int is needed |
| gettext `.decode("utf-8")` | Language | Remove (py3 gettext returns `str`) |
| **Bytes vs str** | midi package (`struct`, `ord`/`chr` over `str`), Network/Session (pickle packets), Cerealizer, `Texture` byte buffers, Song score hashing | Careful manual port with unit tests. Keep high-score hashes identical: `sha1(("%d%d%d%s" % ...).encode("latin-1"))` |
| Mixed tabs/spaces | `Collada.py` (tabs), Guitar | Re-indent (py3 raises `TabError` on inconsistent mixes) |
| `codecs.register(lambda enc: iso8859_1.getregentry())` in FretsOnFire.py | This would hijack **every** codec lookup in py3 | Delete |
| `# -*- coding: iso-8859-1 -*-` headers, latin-1 literals in Credits etc. | | Keep the cookies or re-encode to UTF-8 |

`lib2to3`/`2to3` are gone from CPython 3.13+. Use CPython 3.12's `python3.12 -m lib2to3` (deprecated but present) or `fissix`/`python-modernize` for the mechanical pass, then fix by hand.

### 2.10 Browser-specific UX concerns

- **Default fret keys are F1–F5.** Browsers bind F1 (help), F3 (find), F5 (reload), F11 and F12. Call `preventDefault()` on keydown for F1–F12, arrows, Space, Enter, Tab, Backspace and Escape while the game canvas has focus. Consider browser-friendly default bindings in a first-run config.
- **`Alt+Enter` fullscreen and `Escape`.** `requestFullscreen()` must run inside the user-gesture handler, so JS handles Alt+Enter directly rather than waiting for the queued Python event. In fullscreen, Chromium's `navigator.keyboard.lock()` lets Escape reach the game.
- **Restart.** Changing language, resolution or audio settings calls `engine.restart()` → `os.execl(...)`. In the browser, persist first (`syncfs`), then `location.reload()`.
- **Quit.** `engine.quit()` shows an "exited" overlay with a restart button.
- **Canvas size.** The `video.resolution` default is 640×480, and View applies 4:3 aspect correction. Size the canvas from CSS size × `devicePixelRatio` and emit `VIDEORESIZE` on `ResizeObserver`.
- **Score upload** (`urllib` to `http://fretsonfire.sourceforge.net/play`) has a dead endpoint, and the browser would add CORS and mixed-content failures. Force it off and hide the option.
- **GH importer** needs `oggenc` via `os.system`, which is unavailable. Hide it. The song **importer** needs local files, so it needs `<input type=file>` → MEMFS (optional late step).
- **Log and stdout.** `print` goes to the console via Pyodide stdout. The log file in IDBFS is optional; exclude it from persistence to avoid churn.
- **psyco.** The existing try/except already covers it (import fails and a warning is logged).

### 2.11 Performance considerations

- CPython-in-wasm runs at roughly 1.5–3× native. The original already ran all per-vertex work in Python through slow PyOpenGL ctypes calls, so a pure-Python immediate-mode front-end is a comparable cost. The **FFI crossing count** is the thing to control.
- Hot paths:
  - `Guitar.renderNotes`: per-note `glPushMatrix`/transform/`renderNote`, plus a Python waveform loop filling an 8×4096 numpy array.
  - `Guitar.renderFrets` and Mesh `glCallList`.
  - `Font._renderString`: cached vertex arrays; outline pass draws twice.
  - The Stage layers.
- Small 4×4 numpy ops cost microseconds each. The shim may be faster with plain-Python matrix math or cached numpy buffers, so benchmark it (plan, step 5f).
- Batch uploads: one `Float32Array` vertex arena plus a command stream per frame, handed to JS in a single call.

### 2.12 What can be reused unchanged (after the py3 port)

The following have no platform coupling beyond the items above:

- Scene/World/Session logic
- Song/MIDI parsing
- Menu and Dialog layouts
- Guitar gameplay rules, scoring and Theme
- Config and Stage (ini-driven effects)
- Collada parsing (`xml.dom.minidom`, available)
- Cerealizer (after the port)

## 3. Architecture decision summary

| Concern | Decision |
| --- | --- |
| Python version | Port `src/` in place to Python 3 (branch `pyodide`). Keep it runnable on desktop CPython 3 + pygame-ce + PyOpenGL as a regression reference |
| Rendering | Python `OpenGL` shim package (GL, GLU, GL.ARB.multisample) that emulates fixed function on a **WebGL2** backend in JS, with per-frame batching |
| Blocking loops | **JSPI** via `pyodide.ffi.run_sync`. The single yield point is `Video.flip()` |
| Input | JS DOM + Gamepad listeners → queue → pygame-shaped events in `Input.run` |
| Audio | Web Audio backend implementing the `Audio.py` API. `AudioContext.currentTime` is the song clock |
| Threads | Cooperative resource loader (one job per frame) |
| Network | In-memory loopback transport. Multiplayer disabled |
| Files | Manifest-driven fetch into MEMFS, with lazy stubs for song audio. IDBFS for the writable dir |
| Platform hooks | `sys.platform == "emscripten"` branches in a small number of game modules (Video, Audio, Input, Timer, Resource, Network, GameEngine, FretsOnFire, MainMenu). Browser code lives in `app/python/` |
| Dev/build | Vite multi-page app in `app/`. A custom plugin serves `app/pyodide`, `src/` and `data/` in dev and copies a trimmed set in build. Playwright tests per page |
