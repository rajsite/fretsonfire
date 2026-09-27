"""Page 07: the game's Audio/Song API on Web Audio: synchronized tracks, song clock, volume, pause and SFX."""
import json
import time

from fof_web import frame


def run(seconds):
  import Config
  import Version
  Config.load(Version.appName() + ".ini", setAsDefault = True)
  import Audio
  import Song

  class Engine(object):
    pass

  engine = Engine()
  engine.audio = Audio.Audio()
  engine.audio.open()
  engine.addTask = lambda task, synchronized = True: None
  engine.removeTask = lambda task: None

  base = "../data/songs/tutorial/"
  t0 = time.perf_counter()
  song = Song.Song(engine, base + "song.ini", base + "song.ogg", base + "guitar.ogg", None, base + "notes.mid")
  loadMs = (time.perf_counter() - t0) * 1000
  sfx = Audio.Sound("../data/in.ogg")
  sfxChannel = engine.audio.getChannel(engine.audio.getChannelCount() - 1)

  song.play()
  samples = []
  resumed = []
  wallStart = None
  pausedFor = 0.0
  events = []
  frames = int(seconds * 60)
  for n in range(frames):
    frame.flip()
    now = time.perf_counter() * 1000
    pos = song.getPosition()
    if pos > 0 and wallStart is None:
      wallStart = now - pos
    if wallStart is not None and n < 150:
      samples.append((now - wallStart, pos))
    elif n > 180:
      resumed.append(pos)
    if n == 60:
      song.setGuitarVolume(0.0)
      events.append("guitarMuted")
    if n == 90:
      song.setGuitarVolume(1.0)
      sfxChannel.play(sfx)
      events.append("sfx")
    if n == 150:
      song.pause()
      pauseStart = now
      pausedPos = song.getPosition()
    if n == 180:
      events.append({"pausedDrift": song.getPosition() - pausedPos})
      song.unpause()
      pausedFor += now - pauseStart
  playing = song.isPlaying()
  song.stop()
  engine.audio.close()

  steady = [s for s in samples if s[0] > 200]
  drift = [pos - wall for wall, pos in steady]
  import fofaudio
  return json.dumps({
    "loadMs": loadMs,
    "samples": len(samples),
    "finalPos": resumed[-1] if resumed else 0,
    "maxDrift": max(abs(d - drift[0]) for d in drift) if drift else None,
    "monotonic": all(b[1] >= a[1] for a, b in zip(samples, samples[1:])) and all(b >= a for a, b in zip(resumed, resumed[1:])),
    "events": events,
    "playingAtEnd": playing,
    "info": fofaudio.info().to_py(),
  })
