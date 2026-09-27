"""Browser entry point replacing the __main__ block of FretsOnFire.py."""
import json
import sys

import fofjs
from fof_web import frame, fs


def _publishState(engine):
  state = {"layers": [layer.__class__.__name__ for layer in engine.view.layers]}
  for layer in engine.view.layers:
    player = getattr(layer, "player", None)
    if player is not None and hasattr(player, "score"):
      state["score"] = player.score
      state["notesHit"] = getattr(player, "notesHit", 0)
  if state != _publishState.last:
    _publishState.last = state
    fofjs.setState(json.dumps(state))


_publishState.last = None


def run(argv = ()):
  sys.argv = ["FretsOnFire.py"] + list(argv)
  fs.installHooks()

  import Log
  if "-v" in argv or "--verbose" in argv:
    Log.quiet = False

  songName = None
  for i, arg in enumerate(argv):
    if arg in ("-p", "--play") and i + 1 < len(argv):
      songName = argv[i + 1]

  import Config
  import Version
  from GameEngine import GameEngine
  from MainMenu import MainMenu

  config = Config.load(Version.appName() + ".ini", setAsDefault = True)
  engine = GameEngine(config)
  engine.setStartupLayer(MainMenu(engine, songName = songName))
  # Frames may be rendered from nested dialog loops, so publish from the per-frame flush.
  frame.add_flush_hook(lambda: _publishState(engine))

  while engine.run():
    pass

  restart = engine.restartRequested
  engine.quit()
  fs.persist()
  return "restart" if restart else "quit"
