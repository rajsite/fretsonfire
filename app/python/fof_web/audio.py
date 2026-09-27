"""Web Audio implementation of the game's Audio.py classes (backed by src/audio.ts via the `fofaudio` module)."""
import os

from pyodide.ffi import run_sync, to_js

import fofaudio
import Log
from Task import Task


def _load(fileName):
  return run_sync(fofaudio.load(os.path.abspath(fileName)))


def prefetch(fileNames):
  """Start decoding these files in parallel; later loads pick up the results."""
  for fileName in fileNames:
    fofaudio.prefetch(os.path.abspath(fileName))


def tooLong(fileNames):
  """Whether one song's stems would decode to more memory than the browser version allows."""
  return bool(run_sync(fofaudio.tooLong(to_js([os.path.abspath(f) for f in fileNames]))))


class Audio(Task):
  def __init__(self):
    Task.__init__(self)

  def pre_open(self, frequency = 22050, bits = 16, stereo = True, bufferSize = 1024):
    return True

  def open(self, frequency = 22050, bits = 16, stereo = True, bufferSize = 1024):
    fofaudio.open(8)
    Log.debug("Audio configuration: %s" % fofaudio.info().to_py())
    return True

  def getChannelCount(self):
    return fofaudio.channelCount()

  def getChannel(self, n):
    return Channel(n)

  def close(self):
    fofaudio.closeAll()

  def pause(self):
    fofaudio.pauseAll()

  def unpause(self):
    fofaudio.unpauseAll()

  def run(self, ticks):
    for event in fofaudio.drainEvents():
      if event == "musicEnded" and Music.endEvent is not None:
        from fof_web import input
        input.post(input.Event(Music.endEvent))


class Music(object):
  endEvent = None

  def __init__(self, fileName):
    fofaudio.musicLoad(_load(fileName))

  @staticmethod
  def setEndEvent(event):
    Music.endEvent = event
    fofaudio.musicEndEvent = event is not None

  def play(self, loops = -1, pos = 0.0):
    fofaudio.musicPlay(loops, pos)

  def stop(self):
    fofaudio.musicStop()

  def rewind(self):
    fofaudio.musicRewind()

  def pause(self):
    fofaudio.musicPause()

  def unpause(self):
    fofaudio.musicUnpause()

  def setVolume(self, volume):
    fofaudio.musicSetVolume(volume)

  def fadeout(self, time):
    fofaudio.musicFadeout(time)

  def isPlaying(self):
    return fofaudio.musicIsPlaying()

  def getPosition(self):
    return fofaudio.musicGetPos()


class PreviewMusic(object):
  """Music streamed through a media element instead of being decoded up front (song previews)."""
  def __init__(self, fileName):
    self.id = fofaudio.streamCreate(os.path.abspath(fileName))

  def __del__(self):
    try:
      fofaudio.streamRelease(self.id)
    except Exception:
      pass

  def play(self, loops = -1, pos = 0.0):
    fofaudio.streamPlay(self.id, loops, pos)

  def stop(self):
    fofaudio.streamStop(self.id)

  def rewind(self):
    pass

  def pause(self):
    fofaudio.streamStop(self.id)

  def unpause(self):
    fofaudio.streamResume(self.id)

  def setVolume(self, volume):
    fofaudio.streamSetVolume(self.id, volume)

  def fadeout(self, time):
    fofaudio.streamFadeout(self.id, time)

  def isPlaying(self):
    return fofaudio.streamIsPlaying(self.id)

  def getPosition(self):
    return fofaudio.streamGetPos(self.id)


class Channel(object):
  def __init__(self, id):
    self.id = id

  def play(self, sound):
    fofaudio.soundPlay(sound.id, 0, self.id)

  def stop(self):
    fofaudio.channelStop(self.id)

  def setVolume(self, volume):
    fofaudio.channelSetVolume(self.id, volume)

  def fadeout(self, time):
    fofaudio.channelFadeout(self.id, time)


class Sound(object):
  def __init__(self, fileName):
    self.id = fofaudio.createSound(_load(fileName))

  def __del__(self):
    try:
      fofaudio.soundRelease(self.id)
    except Exception:
      pass

  def play(self, loops = 0):
    fofaudio.soundPlay(self.id, loops, -1)

  def stop(self):
    fofaudio.soundStop(self.id)

  def setVolume(self, volume):
    fofaudio.soundSetVolume(self.id, volume)

  def fadeout(self, time):
    fofaudio.soundFadeout(self.id, time)


class StreamingSound(Sound, Task):
  """Decoding happens natively in the browser, so streaming sounds are regular sounds."""
  def __init__(self, engine, channel, fileName):
    Task.__init__(self)
    Sound.__init__(self, fileName)
    self.channel = channel
