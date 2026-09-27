"""Page 12: a song pack mounted from a zip, seen through the game's library and song APIs."""
import json
import os


class FakeEngine(object):
  pass


def run(root):
  from fof_web import fs, audio
  fs.installHooks()

  import fofaudio
  import Resource
  import Song
  import Version

  engine = FakeEngine()
  engine.resource = Resource.Resource(Version.dataPath())
  packLibrary = Song.DEFAULT_LIBRARY + "/" + os.path.basename(root)
  result = {"topLibraries": [l.libraryName for l in Song.getAvailableLibraries(engine)]}

  libraries = {}
  def walk(library):
    for lib in Song.getAvailableLibraries(engine, library):
      songs = Song.getAvailableSongs(engine, lib.libraryName)
      libraries[lib.libraryName] = {
        "name": lib.name,
        "songs": {s.songName: {"name": s.name, "difficulties": [str(d) for d in s.difficulties]} for s in songs},
      }
      walk(lib.libraryName)
  walk(Song.DEFAULT_LIBRARY)
  result["libraries"] = libraries

  rb = packLibrary + "/Rock Band"
  notes = engine.resource.fileName(rb, "01 RB Style", "notes.mid")
  song = Song.Song(engine, engine.resource.fileName(rb, "01 RB Style", "song.ini"), None, None, None, notes)
  result["rbNotes"] = {str(Song.difficulties[d]): len([1 for t, e in song.tracks[d].allEvents if isinstance(e, Song.Note)]) for d in Song.difficulties}
  result["rbGuitarTrack"] = Song.findGuitarTrack(notes)

  labels = {}
  for parts in [(packLibrary,), (rb, "01 RB Style"), (packLibrary + "/Classic", "03 M\u00f6tley")]:
    path = engine.resource.fileName(*(parts + ("label.png",)))
    with open(path, "rb") as f:
      labels["/".join(parts)] = f.read(8) == b"\x89PNG\r\n\x1a\n"
  result["labels"] = labels

  ogg = engine.resource.fileName(rb, "01 RB Style", "song.ogg")
  result["oggStubSize"] = os.path.getsize(ogg)
  result["oggOrigin"] = fs.urlFor(ogg)
  result["oggSeconds"] = fofaudio.duration(audio._load(ogg))

  audio._load(engine.resource.fileName(packLibrary + "/Classic", "03 M\u00f6tley", "song.ogg"))
  cached = fofaudio.stats().to_py()["cached"]
  result["cachedSongDirs"] = sorted(set(os.path.dirname(p)[len(root) + 1:] for p in cached if p.startswith(root + "/")))

  result["tooLong"] = {
    "04 Long Song": Song.isSongTooLong(engine, "04 Long Song", library = packLibrary + "/Classic"),
    "01 RB Style": Song.isSongTooLong(engine, "01 RB Style", library = rb),
  }
  return json.dumps(result)
