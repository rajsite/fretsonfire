"""Browser entry point replacing the __main__ block of FretsOnFire.py."""
import json
import sys

import fofjs
from fof_web import fs


def _publishState(engine):
  layers = [layer.__class__.__name__ for layer in engine.view.layers]
  if layers != _publishState.last:
    _publishState.last = layers
    fofjs.setState(json.dumps({"layers": layers}))


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

  while engine.run():
    _publishState(engine)

  restart = engine.restartRequested
  engine.quit()
  fs.persist()
  return "restart" if restart else "quit"
