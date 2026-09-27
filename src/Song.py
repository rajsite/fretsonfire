#####################################################################
# -*- coding: iso-8859-1 -*-                                        #
#                                                                   #
# Frets on Fire                                                     #
# Copyright (C) 2006 Sami Ky�stil�                                  #
#                                                                   #
# This program is free software; you can redistribute it and/or     #
# modify it under the terms of the GNU General Public License       #
# as published by the Free Software Foundation; either version 2    #
# of the License, or (at your option) any later version.            #
#                                                                   #
# This program is distributed in the hope that it will be useful,   #
# but WITHOUT ANY WARRANTY; without even the implied warranty of    #
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the     #
# GNU General Public License for more details.                      #
#                                                                   #
# You should have received a copy of the GNU General Public License #
# along with this program; if not, write to the Free Software       #
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,        #
# MA  02110-1301, USA.                                              #
#####################################################################

import midi
import Log
import Audio
import os
import re
import sys
import shutil
import Config
import hashlib
import binascii
import Cerealizer
import urllib.request, urllib.parse, urllib.error
import Version
import Theme
from Language import _
from functools import reduce

DEFAULT_LIBRARY         = "songs"

AMAZING_DIFFICULTY      = 0
MEDIUM_DIFFICULTY       = 1
EASY_DIFFICULTY         = 2
SUPAEASY_DIFFICULTY     = 3

class Difficulty:
  def __init__(self, id, text):
    self.id   = id
    self.text = text
    
  def __str__(self):
    return self.text

  def __repr__(self):
    return self.text

difficulties = {
  SUPAEASY_DIFFICULTY: Difficulty(SUPAEASY_DIFFICULTY, _("Supaeasy")),
  EASY_DIFFICULTY:     Difficulty(EASY_DIFFICULTY,     _("Easy")),
  MEDIUM_DIFFICULTY:   Difficulty(MEDIUM_DIFFICULTY,   _("Medium")),
  AMAZING_DIFFICULTY:  Difficulty(AMAZING_DIFFICULTY,  _("Amazing")),
}

class SongInfo(object):
  def __init__(self, infoFileName, noteFileName = None):
    self.songName      = os.path.basename(os.path.dirname(infoFileName))
    self.fileName      = infoFileName
    self.noteFileName  = noteFileName or os.path.join(os.path.dirname(infoFileName), "notes.mid")
    self.info          = Config.createParser()
    self._difficulties = None

    try:
      Config.readParser(self.info, infoFileName)
    except:
      pass
      
    # Read highscores and verify their hashes.
    # There ain't no security like security throught obscurity :)
    self.highScores = {}
    
    scores = self._get("scores", str, "")
    if scores:
      scores = Cerealizer.loads(binascii.unhexlify(scores))
      for difficulty in list(scores.keys()):
        try:
          difficulty = difficulties[difficulty]
        except KeyError:
          continue
        for score, stars, name, hash in scores[difficulty.id]:
          if self.getScoreHash(difficulty, score, stars, name) == hash:
            self.addHighscore(difficulty, score, stars, name)
          else:
            Log.warn("Weak hack attempt detected. Better luck next time.")

  def _set(self, attr, value):
    if not self.info.has_section("song"):
      self.info.add_section("song")
    self.info.set("song", attr, str(value))
    
  def getObfuscatedScores(self):
    s = {}
    for difficulty in list(self.highScores.keys()):
      s[difficulty.id] = [(score, stars, name, self.getScoreHash(difficulty, score, stars, name)) for score, stars, name in self.highScores[difficulty]]
    return binascii.hexlify(Cerealizer.dumps(s)).decode("ascii")

  def save(self):
    self._set("scores", self.getObfuscatedScores())
    Config.writeParser(self.info, self.fileName)
    
  def _get(self, attr, type = None, default = ""):
    try:
      v = self.info.get("song", attr)
    except:
      v = default
    if v is not None and type:
      v = type(v)
    return v

  def getDifficulties(self):
    # Tutorials only have the medium difficulty
    if self.tutorial:
      return [difficulties[MEDIUM_DIFFICULTY]]

    if self._difficulties is not None:
      return self._difficulties

    # See which difficulties are available
    try:
      noteFileName = self.noteFileName
      info = MidiInfoReader(findGuitarTrack(noteFileName))
      midiIn = midi.MidiInFile(info, noteFileName)
      try:
        midiIn.read()
      except MidiInfoReader.Done:
        pass
      info.difficulties.sort(key = lambda d: -d.id)
      self._difficulties = info.difficulties
    except:
      self._difficulties = list(difficulties.values())
    return self._difficulties

  def getName(self):
    return self._get("name")

  def setName(self, value):
    self._set("name", value)

  def getArtist(self):
    return self._get("artist")

  def getCassetteColor(self):
    c = self._get("cassettecolor")
    if c:
      return Theme.hexToColor(c)
  
  def setCassetteColor(self, color):
    self._set("cassettecolor", Theme.colorToHex(color))
  
  def setArtist(self, value):
    self._set("artist", value)
    
  def getScoreHash(self, difficulty, score, stars, name):
    return hashlib.sha1(("%d%d%d%s" % (difficulty.id, score, stars, name)).encode("utf-8")).hexdigest()
    
  def getDelay(self):
    return self._get("delay", int, 0)
    
  def setDelay(self, value):
    return self._set("delay", value)
    
  def getHighscores(self, difficulty):
    try:
      return self.highScores[difficulty]
    except KeyError:
      return []

  def uploadHighscores(self, url, songHash):
    try:
      d = {
        "songName": self.songName,
        "songHash": songHash,
        "scores":   self.getObfuscatedScores(),
        "version":  Version.version()
      }
      data = urllib.request.urlopen(url + "?" + urllib.parse.urlencode(d)).read().decode("utf-8", "replace")
      Log.debug("Score upload result: %s" % data)
      if ";" in data:
        fields = data.split(";")
      else:
        fields = [data, "0"]
      return (fields[0] == "True", int(fields[1]))
    except Exception as e:
      Log.error(e)
      return (False, 0)
  
  def addHighscore(self, difficulty, score, stars, name):
    if not difficulty in self.highScores:
      self.highScores[difficulty] = []
    self.highScores[difficulty].append((score, stars, name))
    # Stable sort, highest score first (ties keep insertion order).
    self.highScores[difficulty].sort(key = lambda s: -s[0])
    self.highScores[difficulty] = self.highScores[difficulty][:5]
    for i, scores in enumerate(self.highScores[difficulty]):
      _score, _stars, _name = scores
      if _score == score and _stars == stars and _name == name:
        return i
    return -1

  def isTutorial(self):
    return self._get("tutorial", int, 0) == 1
    
  name          = property(getName, setName)
  artist        = property(getArtist, setArtist)
  delay         = property(getDelay, setDelay)
  tutorial      = property(isTutorial)
  difficulties  = property(getDifficulties)
  cassetteColor = property(getCassetteColor, setCassetteColor)

class LibraryInfo(object):
  def __init__(self, libraryName, infoFileName):
    self.libraryName   = libraryName
    self.fileName      = infoFileName
    self.info          = Config.createParser()
    self.songCount     = 0

    try:
      Config.readParser(self.info, infoFileName)
    except:
      pass

    # Set a default name
    if not self.name:
      self.name = os.path.basename(os.path.dirname(self.fileName))

    # Count the available songs
    libraryRoot = os.path.dirname(self.fileName)
    for name in os.listdir(libraryRoot):
      if not os.path.isdir(os.path.join(libraryRoot, name)) or name.startswith("."):
        continue
      if os.path.isfile(os.path.join(libraryRoot, name, "song.ini")):
        self.songCount += 1

  def _set(self, attr, value):
    if not self.info.has_section("library"):
      self.info.add_section("library")
    self.info.set("library", attr, str(value))
    
  def save(self):
    Config.writeParser(self.info, self.fileName)
    
  def _get(self, attr, type = None, default = ""):
    try:
      v = self.info.get("library", attr)
    except:
      v = default
    if v is not None and type:
      v = type(v)
    return v

  def getName(self):
    return self._get("name")

  def setName(self, value):
    self._set("name", value)

  def getColor(self):
    c = self._get("color")
    if c:
      return Theme.hexToColor(c)
  
  def setColor(self, color):
    self._set("color", Theme.colorToHex(color))
    
    
  name          = property(getName, setName)
  color         = property(getColor, setColor)

class Event:
  def __init__(self, length):
    self.length = length

class Note(Event):
  def __init__(self, number, length, special = False, tappable = False):
    Event.__init__(self, length)
    self.number   = number
    self.played   = False
    self.special  = special
    self.tappable = tappable
    
  def __repr__(self):
    return "<#%d>" % self.number

class Tempo(Event):
  def __init__(self, bpm):
    Event.__init__(self, 0)
    self.bpm = bpm
    
  def __repr__(self):
    return "<%d bpm>" % self.bpm

class TextEvent(Event):
  def __init__(self, text, length):
    Event.__init__(self, length)
    self.text = text

  def __repr__(self):
    return "<%s>" % self.text

class PictureEvent(Event):
  def __init__(self, fileName, length):
    Event.__init__(self, length)
    self.fileName = fileName
    
class Track:
  granularity = 50
  
  def __init__(self):
    self.events = []
    self.allEvents = []

  def addEvent(self, time, event):
    for t in range(int(time / self.granularity), int((time + event.length) / self.granularity) + 1):
      if len(self.events) < t + 1:
        n = t + 1 - len(self.events)
        n *= 8
        self.events = self.events + [[] for n in range(n)]
      self.events[t].append((time - (t * self.granularity), event))
    self.allEvents.append((time, event))

  def removeEvent(self, time, event):
    for t in range(int(time / self.granularity), int((time + event.length) / self.granularity) + 1):
      e = (time - (t * self.granularity), event)
      if t < len(self.events) and e in self.events[t]:
        self.events[t].remove(e)
    if (time, event) in self.allEvents:
      self.allEvents.remove((time, event))

  def getEvents(self, startTime, endTime):
    t1, t2 = [int(x) for x in [startTime / self.granularity, endTime / self.granularity]]
    if t1 > t2:
      t1, t2 = t2, t1

    events = set()
    for t in range(max(t1, 0), min(len(self.events), t2)):
      for diff, event in self.events[t]:
        time = (self.granularity * t) + diff
        events.add((time, event))
    return events

  def getAllEvents(self):
    return self.allEvents

  def reset(self):
    for eventList in self.events:
      for time, event in eventList:
        if isinstance(event, Note):
          event.played = False

  def update(self):
    # Determine which notes are tappable. The rules are:
    #  1. Not the first note of the track
    #  2. Previous note not the same as this one
    #  3. Previous note not a chord
    #  4. Previous note ends at most 161 ticks before this one
    bpm             = None
    ticksPerBeat    = 480
    tickThreshold   = 161
    prevNotes       = []
    currentNotes    = []
    currentTicks    = 0.0
    prevTicks       = 0.0
    epsilon         = 1e-3

    def beatsToTicks(time):
      return (time * bpm * ticksPerBeat) / 60000.0

    if not self.allEvents:
      return

    for time, event in self.allEvents + [self.allEvents[-1]]:
      if isinstance(event, Tempo):
        bpm = event.bpm
      elif isinstance(event, Note):
        # All notes are initially not tappable
        event.tappable = False
        ticks = beatsToTicks(time)
        
        # Part of chord?
        if ticks < currentTicks + epsilon:
          currentNotes.append(event)
          continue
        
        """
        for i in range(5):
          if i in [n.number for n in prevNotes]:
            print " # ",
          else:
            print " . ",
        print " | ",
        for i in range(5):
          if i in [n.number for n in currentNotes]:
            print " # ",
          else:
            print " . ",
        print
        """

        # Previous note not a chord?
        if len(prevNotes) == 1:
          # Previous note ended recently enough?
          prevEndTicks = prevTicks + beatsToTicks(prevNotes[0].length)
          if currentTicks - prevEndTicks <= tickThreshold:
            for note in currentNotes:
              # Are any current notes the same as the previous one?
              if note.number == prevNotes[0].number:
                break
            else:
              # If all the notes are different, mark the current notes tappable
              for note in currentNotes:
                note.tappable = True

        # Set the current notes as the previous notes
        prevNotes    = currentNotes
        prevTicks    = currentTicks
        currentNotes = [event]
        currentTicks = ticks

class Song(object):
  def __init__(self, engine, infoFileName, songTrackName, guitarTrackName, rhythmTrackName, noteFileName, scriptFileName = None, drumsTrackName = None):
    self.engine        = engine
    self.info          = SongInfo(infoFileName, noteFileName)
    self.tracks        = [Track() for t in range(len(difficulties))]
    self.difficulty    = difficulties[AMAZING_DIFFICULTY]
    self._playing      = False
    self.start         = 0.0
    self.noteFileName  = noteFileName
    self.bpm           = None
    self.period        = 0

    # load the tracks
    Audio.prefetch([n for n in (songTrackName, guitarTrackName, rhythmTrackName, drumsTrackName) if n])
    if songTrackName:
      self.music       = Audio.Music(songTrackName)

    self.guitarTrack = None
    self.rhythmTrack = None
    self.drumsTrack  = None

    try:
      if guitarTrackName:
        self.guitarTrack = Audio.StreamingSound(self.engine, self.engine.audio.getChannel(1), guitarTrackName)
    except Exception as e:
      Log.warn("Unable to load guitar track: %s" % e)

    try:
      if rhythmTrackName:
        self.rhythmTrack = Audio.StreamingSound(self.engine, self.engine.audio.getChannel(2), rhythmTrackName)
    except Exception as e:
      Log.warn("Unable to load rhythm track: %s" % e)

    try:
      if drumsTrackName:
        self.drumsTrack = Audio.StreamingSound(self.engine, self.engine.audio.getChannel(3), drumsTrackName)
    except Exception as e:
      Log.warn("Unable to load drums track: %s" % e)
	
    # load the notes
    if noteFileName:
      midiIn = midi.MidiInFile(MidiReader(self, findGuitarTrack(noteFileName)), noteFileName)
      midiIn.read()

    # load the script
    if scriptFileName and os.path.isfile(scriptFileName):
      scriptReader = ScriptReader(self, open(scriptFileName, encoding = Config.encoding))
      scriptReader.read()

    # update all note tracks
    for track in self.tracks:
      track.update()

  def getHash(self):
    h = hashlib.sha1()
    f = open(self.noteFileName, "rb")
    bs = 1024
    while True:
      data = f.read(bs)
      if not data: break
      h.update(data)
    return h.hexdigest()
  
  def setBpm(self, bpm):
    self.bpm    = bpm
    self.period = 60000.0 / self.bpm

  def save(self):
    self.info.save()
    f = open(self.noteFileName + ".tmp", "wb")
    midiOut = MidiWriter(self, midi.MidiOutFile(f))
    midiOut.write()
    f.close()

    # Rename the output file after it has been succesfully written
    shutil.move(self.noteFileName + ".tmp", self.noteFileName)

  def play(self, start = 0.0):
    self.start = start
    self.music.play(0, start / 1000.0)
    if self.guitarTrack:
      assert start == 0.0
      self.guitarTrack.play()
    if self.rhythmTrack:
      assert start == 0.0
      self.rhythmTrack.play()
    if self.drumsTrack:
      assert start == 0.0
      self.drumsTrack.play()
    self._playing = True

  def pause(self):
    self.music.pause()
    self.engine.audio.pause()

  def unpause(self):
    self.music.unpause()
    self.engine.audio.unpause()

  def setGuitarVolume(self, volume):
    if not self.rhythmTrack:
      volume = max(.1, volume)
    if self.guitarTrack:
      self.guitarTrack.setVolume(volume)
    else:
      self.music.setVolume(volume)

  def setRhythmVolume(self, volume):
    if self.rhythmTrack:
      self.rhythmTrack.setVolume(volume)
  
  def setBackgroundVolume(self, volume):
    self.music.setVolume(volume)
    if self.drumsTrack:
      self.drumsTrack.setVolume(volume)
  
  def stop(self):
    for track in self.tracks:
      track.reset()
      
    self.music.stop()
    self.music.rewind()
    if self.guitarTrack:
      self.guitarTrack.stop()
    if self.rhythmTrack:
      self.rhythmTrack.stop()
    if self.drumsTrack:
      self.drumsTrack.stop()
    self._playing = False

  def fadeout(self, time):
    for track in self.tracks:
      track.reset()
      
    self.music.fadeout(time)
    if self.guitarTrack:
      self.guitarTrack.fadeout(time)
    if self.rhythmTrack:
      self.rhythmTrack.fadeout(time)
    if self.drumsTrack:
      self.drumsTrack.fadeout(time)
    self._playing = False

  def getPosition(self):
    if not self._playing:
      pos = 0.0
    else:
      pos = self.music.getPosition()
    if pos < 0.0:
      pos = 0.0
    return pos + self.start

  def isPlaying(self):
    return self._playing and self.music.isPlaying()

  def getBeat(self):
    return self.getPosition() / self.period

  def update(self, ticks):
    pass

  def getTrack(self):
    return self.tracks[self.difficulty.id]

  track = property(getTrack)

noteMap = {     # difficulty, note
  0x60: (AMAZING_DIFFICULTY,  0),
  0x61: (AMAZING_DIFFICULTY,  1),
  0x62: (AMAZING_DIFFICULTY,  2),
  0x63: (AMAZING_DIFFICULTY,  3),
  0x64: (AMAZING_DIFFICULTY,  4),
  0x54: (MEDIUM_DIFFICULTY,   0),
  0x55: (MEDIUM_DIFFICULTY,   1),
  0x56: (MEDIUM_DIFFICULTY,   2),
  0x57: (MEDIUM_DIFFICULTY,   3),
  0x58: (MEDIUM_DIFFICULTY,   4),
  0x48: (EASY_DIFFICULTY,     0),
  0x49: (EASY_DIFFICULTY,     1),
  0x4a: (EASY_DIFFICULTY,     2),
  0x4b: (EASY_DIFFICULTY,     3),
  0x4c: (EASY_DIFFICULTY,     4),
  0x3c: (SUPAEASY_DIFFICULTY, 0),
  0x3d: (SUPAEASY_DIFFICULTY, 1),
  0x3e: (SUPAEASY_DIFFICULTY, 2),
  0x3f: (SUPAEASY_DIFFICULTY, 3),
  0x40: (SUPAEASY_DIFFICULTY, 4),
}

reverseNoteMap = dict([(v, k) for k, v in list(noteMap.items())])

class MidiWriter:
  def __init__(self, song, out):
    self.song         = song
    self.out          = out
    self.ticksPerBeat = 480

  def midiTime(self, time):
    return int(self.song.bpm * self.ticksPerBeat * time / 60000.0)

  def write(self):
    self.out.header(division = self.ticksPerBeat)
    self.out.start_of_track()
    self.out.update_time(0)
    if self.song.bpm:
      self.out.tempo(int(60.0 * 10.0**6 / self.song.bpm))
    else:
      self.out.tempo(int(60.0 * 10.0**6 / 122.0))

    # Collect all events
    events = [list(zip([difficulty] * len(track.getAllEvents()), track.getAllEvents())) for difficulty, track in enumerate(self.song.tracks)]
    events = reduce(lambda a, b: a + b, events)
    events.sort(key = lambda e: e[1][0])
    heldNotes = []

    for difficulty, event in events:
      time, event = event
      if isinstance(event, Note):
        time = self.midiTime(time)

        # Turn of any held notes that were active before this point in time
        for note, endTime in list(heldNotes):
          if endTime <= time:
            self.out.update_time(endTime, relative = 0)
            self.out.note_off(0, note)
            heldNotes.remove((note, endTime))

        note = reverseNoteMap[(difficulty, event.number)]
        self.out.update_time(time, relative = 0)
        self.out.note_on(0, note, event.special and 127 or 100)
        heldNotes.append((note, time + self.midiTime(event.length)))
        heldNotes.sort(key = lambda n: n[1])

    # Turn of any remaining notes
    for note, endTime in heldNotes:
      self.out.update_time(endTime, relative = 0)
      self.out.note_off(0, note)
      
    self.out.update_time(0)
    self.out.end_of_track()
    self.out.eof()
    self.out.write()

class ScriptReader:
  def __init__(self, song, scriptFile):
    self.song = song
    self.file = scriptFile

  def read(self):
    for line in self.file:
      if line.startswith("#"): continue
      time, length, type, data = re.split("[\t ]+", line.strip(), maxsplit = 3)
      time   = float(time)
      length = float(length)

      if type == "text":
        event = TextEvent(data, length)
      elif type == "pic":
        event = PictureEvent(data, length)
      else:
        continue

      for track in self.song.tracks:
        track.addEvent(time, event)

# Track names of the guitar part in Rock Band / Guitar Hero style MIDI files.
GUITAR_TRACK_NAMES = ("PART GUITAR", "T1 GEMS")

def _readVarLen(data, pos):
  value = 0
  while pos < len(data):
    b = data[pos]
    pos += 1
    value = (value << 7) | (b & 0x7f)
    if not b & 0x80:
      break
  return value, pos

def _trackName(body):
  """The first track name meta event at the start of a track, or None."""
  pos, running = 0, 0
  while pos < len(body):
    delta, pos = _readVarLen(body, pos)
    if delta or pos >= len(body):
      break
    status = body[pos]
    if status & 0x80:
      pos += 1
    else:
      status = running
    if status == 0xff:
      kind = body[pos]
      length, pos = _readVarLen(body, pos + 1)
      if kind == 0x03:
        return body[pos:pos + length].decode("latin-1")
      pos += length
    elif status in (0xf0, 0xf7):
      length, pos = _readVarLen(body, pos)
      pos += length
    elif 0x80 <= status < 0xf0:
      running = status
      pos += 1 if 0xc0 <= status < 0xe0 else 2
    else:
      break
  return None

def findGuitarTrack(noteFileName):
  """Index of the track named as the guitar part, or None for files without named parts."""
  with open(noteFileName, "rb") as f:
    data = f.read()
  pos, index = 0, 0
  while pos + 8 <= len(data):
    tag = data[pos:pos + 4]
    length = int.from_bytes(data[pos + 4:pos + 8], "big")
    body = data[pos + 8:pos + 8 + length]
    pos += 8 + length
    if tag != b"MTrk":
      continue
    name = _trackName(body)
    if name is not None and name.strip().upper() in GUITAR_TRACK_NAMES:
      return index
    index += 1
  return None

def _isGuitarTrack(track, guitarTrack):
  # Legacy Frets on Fire files keep the notes in the first two tracks.
  return track == guitarTrack if guitarTrack is not None else track <= 1

class MidiReader(midi.MidiOutStream):
  def __init__(self, song, guitarTrack = None):
    midi.MidiOutStream.__init__(self)
    self.song = song
    self.guitarTrack = guitarTrack
    self.heldNotes = {}
    self.velocity  = {}
    self.ticksPerBeat = 480
    self.tempoMarkers = []

  def addEvent(self, track, event, time = None):
    if time is None:
      time = self.abs_time()
    assert time >= 0
    if track is None:
      for t in self.song.tracks:
        t.addEvent(time, event)
    elif track < len(self.song.tracks):
      self.song.tracks[track].addEvent(time, event)

  def abs_time(self):
    def ticksToBeats(ticks, bpm):
      return (60000.0 * ticks) / (bpm * self.ticksPerBeat)
      
    if self.song.bpm:
      currentTime = midi.MidiOutStream.abs_time(self)

      # Find out the current scaled time.
      # Yeah, this is reeally slow, but fast enough :)
      scaledTime      = 0.0
      tempoMarkerTime = 0.0
      currentBpm      = self.song.bpm
      for i, marker in enumerate(self.tempoMarkers):
        time, bpm = marker
        if time > currentTime:
          break
        scaledTime += ticksToBeats(time - tempoMarkerTime, currentBpm)
        tempoMarkerTime, currentBpm = time, bpm
      return scaledTime + ticksToBeats(currentTime - tempoMarkerTime, currentBpm)
    return 0.0

  def header(self, format, nTracks, division):
    self.ticksPerBeat = division
    
  def tempo(self, value):
    bpm = 60.0 * 10.0**6 / value
    self.tempoMarkers.append((midi.MidiOutStream.abs_time(self), bpm))
    if not self.song.bpm:
      self.song.setBpm(bpm)
    self.addEvent(None, Tempo(bpm))

  def note_on(self, channel, note, velocity):
    if not _isGuitarTrack(self.get_current_track(), self.guitarTrack): return
    self.velocity[note] = velocity
    self.heldNotes[(self.get_current_track(), channel, note)] = self.abs_time()

  def note_off(self, channel, note, velocity):
    if not _isGuitarTrack(self.get_current_track(), self.guitarTrack): return
    try:
      startTime = self.heldNotes[(self.get_current_track(), channel, note)]
      endTime   = self.abs_time()
      del self.heldNotes[(self.get_current_track(), channel, note)]
      if note in noteMap:
        track, number = noteMap[note]
        self.addEvent(track, Note(number, endTime - startTime, special = self.velocity[note] == 127), time = startTime)
      else:
        #Log.warn("MIDI note 0x%x at %d does not map to any game note." % (note, self.abs_time()))
        pass
    except KeyError:
      Log.warn("MIDI note 0x%x on channel %d ending at %d was never started." % (note, channel, self.abs_time()))
      
class MidiInfoReader(midi.MidiOutStream):
  # We exit via this exception so that we don't need to read the whole file in
  class Done(Exception): pass
  
  def __init__(self, guitarTrack = None):
    midi.MidiOutStream.__init__(self)
    self.guitarTrack = guitarTrack
    self.difficulties = []

  def note_on(self, channel, note, velocity):
    if not _isGuitarTrack(self.get_current_track(), self.guitarTrack): return
    try:
      track, number = noteMap[note]
      diff = difficulties[track]
      if not diff in self.difficulties:
        self.difficulties.append(diff)
        if len(self.difficulties) == len(difficulties):
          raise MidiInfoReader.Done
    except KeyError:
      pass

def loadSong(engine, name, library = DEFAULT_LIBRARY, seekable = False, playbackOnly = False, notesOnly = False):
  guitarFile = engine.resource.fileName(library, name, "guitar.ogg")
  songFile   = engine.resource.fileName(library, name, "song.ogg")
  rhythmFile = engine.resource.fileName(library, name, "rhythm.ogg")
  drumsFile  = engine.resource.fileName(library, name, "drums.ogg")
  noteFile   = engine.resource.fileName(library, name, "notes.mid", writable = True)
  infoFile   = engine.resource.fileName(library, name, "song.ini", writable = True)
  scriptFile = engine.resource.fileName(library, name, "script.txt")
  
  if seekable:
    if os.path.isfile(guitarFile) and os.path.isfile(songFile):
      # TODO: perform mixing here
      songFile   = guitarFile
      guitarFile = None
    else:
      songFile   = guitarFile
      guitarFile = None
      
  if not os.path.isfile(songFile):
    songFile   = guitarFile
    guitarFile = None
  
  if not os.path.isfile(rhythmFile):
    rhythmFile = None

  if not os.path.isfile(drumsFile) or playbackOnly:
    drumsFile = None
  
  if playbackOnly:
    noteFile = None
  
  song       = Song(engine, infoFile, songFile, guitarFile, rhythmFile, noteFile, scriptFile, drumsFile)
  return song

def loadSongInfo(engine, name, library = DEFAULT_LIBRARY):
  infoFile   = engine.resource.fileName(library, name, "song.ini", writable = True)
  return SongInfo(infoFile, engine.resource.fileName(library, name, "notes.mid"))

def isSongTooLong(engine, name, library = DEFAULT_LIBRARY):
  """In the browser, songs whose decoded audio would not fit in memory cannot be played."""
  if sys.platform != "emscripten":
    return False
  from fof_web import audio
  stems = [engine.resource.fileName(library, name, f) for f in ("song.ogg", "guitar.ogg", "rhythm.ogg", "drums.ogg")]
  return audio.tooLong([f for f in stems if os.path.isfile(f)])
  
def createSong(engine, name, guitarTrackName, backgroundTrackName, rhythmTrackName = None, library = DEFAULT_LIBRARY):
  path = os.path.abspath(engine.resource.fileName(library, name, writable = True))
  os.makedirs(path)
  
  guitarFile = engine.resource.fileName(library, name, "guitar.ogg", writable = True)
  songFile   = engine.resource.fileName(library, name, "song.ogg",   writable = True)
  noteFile   = engine.resource.fileName(library, name, "notes.mid",  writable = True)
  infoFile   = engine.resource.fileName(library, name, "song.ini",   writable = True)
  
  shutil.copy(guitarTrackName, guitarFile)
  
  if backgroundTrackName:
    shutil.copy(backgroundTrackName, songFile)
  else:
    songFile   = guitarFile
    guitarFile = None

  if rhythmTrackName:
    rhythmFile = engine.resource.fileName(library, name, "rhythm.ogg", writable = True)
    shutil.copy(rhythmTrackName, rhythmFile)
  else:
    rhythmFile = None
    
  f = open(noteFile, "wb")
  m = midi.MidiOutFile(f)
  m.header()
  m.start_of_track()
  m.update_time(0)
  m.end_of_track()
  m.eof()
  m.write()
  f.close()

  song = Song(engine, infoFile, songFile, guitarFile, rhythmFile, noteFile)
  song.info.name = name
  song.save()
  
  return song

def getDefaultLibrary(engine):
  return LibraryInfo(DEFAULT_LIBRARY, engine.resource.fileName(DEFAULT_LIBRARY, "library.ini"))

def getAvailableLibraries(engine, library = DEFAULT_LIBRARY):
  # Search for libraries in both the read-write and read-only directories
  songRoots    = [engine.resource.fileName(library),
                  engine.resource.fileName(library, writable = True)]
  libraries    = []
  libraryRoots = []
  
  for songRoot in songRoots:
    for libraryRoot in os.listdir(songRoot):
      libraryRoot = os.path.join(songRoot, libraryRoot)
      if not os.path.isdir(libraryRoot):
        continue
      for name in os.listdir(libraryRoot):
        # If the directory has at least one song under it or a file called "library.ini", add it
        if os.path.isfile(os.path.join(libraryRoot, name, "song.ini")) or \
           name == "library.ini":
          if not libraryRoot in libraryRoots:
            libName = library + os.path.join(libraryRoot.replace(songRoot, ""))
            libraries.append(LibraryInfo(libName, os.path.join(libraryRoot, "library.ini")))
            libraryRoots.append(libraryRoot)
            break
  libraries.sort(key = lambda l: l.name)
  return libraries

def getAvailableSongs(engine, library = DEFAULT_LIBRARY, includeTutorials = False):
  # Search for songs in both the read-write and read-only directories
  songRoots = [engine.resource.fileName(library), engine.resource.fileName(library, writable = True)]
  names = []
  for songRoot in songRoots:
    for name in os.listdir(songRoot):
      if not os.path.isfile(os.path.join(songRoot, name, "song.ini")) or name.startswith("."):
        continue
      if not name in names:
        names.append(name)

  songs = [SongInfo(engine.resource.fileName(library, name, "song.ini", writable = True),
                    engine.resource.fileName(library, name, "notes.mid")) for name in names]
  if not includeTutorials:
    songs = [song for song in songs if not song.tutorial]
  songs.sort(key = lambda s: s.name)
  return songs
