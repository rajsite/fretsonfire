"""
Desktop smoke test for the Python 3 port: boots the real game with PyOpenGL,
drives it with synthetic key events and saves screenshots.

Usage: python desktop_smoke.py <outdir> [songName]
"""
import os
import sys

SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "src"))
sys.path.insert(0, SRC)
os.chdir(SRC)

import pygame
from OpenGL.GL import glReadPixels, glReadBuffer, glGetIntegerv, GL_FRONT, GL_VIEWPORT, GL_RGB, GL_UNSIGNED_BYTE
from PIL import Image

import Log
import Config
import Version
from GameEngine import GameEngine
from MainMenu import MainMenu

errors = []
_error = Log.error
Log.error = lambda msg: (errors.append(str(msg)), _error(msg))
Log.quiet = False


def screenshot(path):
  x, y, w, h = [int(v) for v in glGetIntegerv(GL_VIEWPORT)]
  glReadBuffer(GL_FRONT)
  data = glReadPixels(0, 0, w, h, GL_RGB, GL_UNSIGNED_BYTE)
  Image.frombytes("RGB", (w, h), data).transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(path)


def key(k, down = True):
  pygame.event.post(pygame.event.Event(pygame.KEYDOWN if down else pygame.KEYUP, key = k, unicode = "", mod = 0, scancode = 0))


def main():
  outDir = sys.argv[1]
  songName = sys.argv[2] if len(sys.argv) > 2 else None
  os.makedirs(outDir, exist_ok = True)

  config = Config.load(Version.appName() + ".ini", setAsDefault = True)
  engine = GameEngine(config)
  engine.setStartupLayer(MainMenu(engine, songName = songName))

  script = {}
  if songName:
    # Hold frets and strum periodically to exercise the guitar scene.
    for i, frame in enumerate(range(400, 1400, 40)):
      fret = [pygame.K_F1, pygame.K_F2, pygame.K_F3][i % 3]
      script[frame] = [(fret, True), (pygame.K_RETURN, True)]
      script[frame + 10] = [(pygame.K_RETURN, False), (fret, False)]
    shots = {300: "song-start.png", 900: "song-mid.png", 1400: "song-late.png"}
    frames = 1450
  else:
    script = {150: [(pygame.K_DOWN, True)], 155: [(pygame.K_DOWN, False)],
              160: [(pygame.K_DOWN, True)], 165: [(pygame.K_DOWN, False)],
              170: [(pygame.K_RETURN, True)], 175: [(pygame.K_RETURN, False)]}
    shots = {140: "menu.png", 260: "settings.png"}
    frames = 280

  for frame in range(frames):
    for k, down in script.get(frame, []):
      key(k, down)
    if not engine.run():
      break
    if frame in shots:
      screenshot(os.path.join(outDir, shots[frame]))

  # Tearing down mid-song can raise errors from dialogs shown during shutdown; only count gameplay errors.
  failures = list(errors)
  print("ERRORS: %d" % len(failures))
  for e in failures:
    print("  " + e)
  sys.stdout.flush()
  engine.quit()
  return 1 if failures else 0


if __name__ == "__main__":
  sys.exit(main())
