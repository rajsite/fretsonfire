"""Page 06: keyboard/mouse events through the game's own Input task."""
import json

import pygame

from fof_web import frame


def run(frames):
  import Config
  import Version
  Config.load(Version.appName() + ".ini", setAsDefault = True)
  import Input
  from Input import KeyListener, MouseListener

  log = {"pressed": [], "released": [], "unicode": [], "mouse": [], "controls": []}

  class Keys(KeyListener):
    def keyPressed(self, key, unicode):
      log["pressed"].append(key)
      log["unicode"].append(unicode)
      log["controls"].append(inp.controls.getMapping(key))
      return True

    def keyReleased(self, key):
      log["released"].append(key)
      return True

  class Mouse(MouseListener):
    def mouseButtonPressed(self, button, pos):
      log["mouse"].append(["down", button, list(pos)])

  inp = Input.Input()
  inp.addKeyListener(Keys())
  inp.addMouseListener(Mouse())
  for _ in range(frames):
    inp.run(0)
    frame.flip()

  import fofjs
  fofjs.setStatus("done")
  names = {name: getattr(pygame, name) for name in ("K_F1", "K_F2", "K_F5", "K_RETURN", "K_ESCAPE", "K_a", "K_LEFT")}
  return json.dumps({"log": log, "keys": names, "keyNameF1": pygame.key.name(pygame.K_F1),
                     "controlsKey1": inp.controls.getMapping(pygame.K_F1)})
