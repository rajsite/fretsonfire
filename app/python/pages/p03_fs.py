"""Page 03: game files in MEMFS, song library scanning, MIDI parsing, persistence and the core test suite."""
import io
import json
import os
import sys
import unittest


class FakeEngine(object):
  pass


def run(token, check):
  from fof_web import fs
  fs.installHooks()

  import Version
  import Config
  import Resource
  import Song

  result = {"cwd": os.getcwd(), "dataPath": os.path.abspath(Version.dataPath())}

  engine = FakeEngine()
  engine.resource = Resource.Resource(Version.dataPath())
  songs = Song.getAvailableSongs(engine, includeTutorials = True)
  result["songs"] = {s.songName: [str(d) for d in s.difficulties] for s in songs}
  result["libraries"] = [l.name for l in Song.getAvailableLibraries(engine)]

  guitar = engine.resource.fileName("songs", "defy", "guitar.ogg")
  result["lazyGuitar"] = {"size": os.path.getsize(guitar), "url": fs.urlFor(guitar)}
  result["writablePath"] = Resource.getWritableResourcePath()
  result["translations"] = sorted(os.listdir(os.path.join(Version.dataPath(), "translations")))

  config = Config.load(Version.appName() + ".ini", setAsDefault = True)
  result["configFile"] = config.fileName
  if check:
    result["storedToken"] = config.config.get("fofweb", "token", fallback = None)
  else:
    if not config.config.has_section("fofweb"):
      config.config.add_section("fofweb")
    config.config.set("fofweb", "token", token)
    Config.writeParser(config.config, config.fileName)
    result["wroteToken"] = token

  sys.path.insert(0, "/game/app-python/tests")
  os.environ["FOF_SRC"] = "/game/src"
  import test_core
  stream = io.StringIO()
  outcome = unittest.TextTestRunner(stream = stream, verbosity = 1).run(unittest.defaultTestLoader.loadTestsFromModule(test_core))
  os.chdir("/game/src")
  result["tests"] = {"run": outcome.testsRun, "failures": len(outcome.failures), "errors": len(outcome.errors), "output": stream.getvalue()[-3000:]}
  return json.dumps(result)
