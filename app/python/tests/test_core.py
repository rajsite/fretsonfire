"""Platform-independent regression tests for the Python 3 port (run on desktop CPython and Pyodide)."""
import os
import shutil
import sys
import tempfile
import unittest

SRC = os.environ.get("FOF_SRC") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "src"))
DATA = os.path.join(SRC, "..", "data")
if SRC not in sys.path:
  sys.path.insert(0, SRC)
os.chdir(SRC)

import Cerealizer
import Config
import Network
import Song
import midi


class FakeEngine(object):
  pass


def songPath(name, fileName):
  return os.path.join(DATA, "songs", name, fileName)


class MidiTest(unittest.TestCase):
  def loadNotes(self, noteFile):
    return Song.Song(FakeEngine(), songPath("defy", "song.ini"), None, None, None, noteFile)

  def testBpm(self):
    song = self.loadNotes(songPath("defy", "notes.mid"))
    self.assertEqual(int(song.bpm), 122)
    self.assertTrue(len(song.track.allEvents) > 100)

  def testDifficulties(self):
    ids = [d.id for d in Song.SongInfo(songPath("defy", "song.ini")).difficulties]
    self.assertEqual(ids, sorted(ids, reverse = True))
    self.assertEqual(ids, [Song.EASY_DIFFICULTY, Song.MEDIUM_DIFFICULTY, Song.AMAZING_DIFFICULTY])

  def testRoundTrip(self):
    tmp = tempfile.mkdtemp()
    try:
      noteFile = os.path.join(tmp, "notes.mid")
      shutil.copy(songPath("bangbang", "notes.mid"), noteFile)
      infoFile = os.path.join(tmp, "song.ini")
      shutil.copy(songPath("bangbang", "song.ini"), infoFile)
      song = Song.Song(FakeEngine(), infoFile, None, None, None, noteFile)
      notes1 = [(t, e) for t, e in song.track.allEvents if isinstance(e, Song.Note)]
      song.save()
      song = Song.Song(FakeEngine(), infoFile, None, None, None, noteFile)
      notes2 = [(t, e) for t, e in song.track.allEvents if isinstance(e, Song.Note)]
      self.assertEqual(len(notes1), len(notes2))
      for (t1, n1), (t2, n2) in zip(notes1, notes2):
        self.assertLess(abs(t1 - t2), 2)
        self.assertLess(abs(n1.length - n2.length), 2)
        self.assertEqual(n1.number, n2.number)
    finally:
      shutil.rmtree(tmp)


def midiFile(tracks, format = 1):
  """Standard MIDI file bytes; tracks are (name or None, [notes]) with notes played one beat apart."""
  def varLen(n):
    out = [n & 0x7f]
    n >>= 7
    while n:
      out.insert(0, 0x80 | (n & 0x7f))
      n >>= 7
    return bytes(out)
  chunks = [b"MThd" + (6).to_bytes(4, "big") + format.to_bytes(2, "big") + len(tracks).to_bytes(2, "big") + (480).to_bytes(2, "big")]
  for i, (name, notes) in enumerate(tracks):
    body = b""
    if i == 0:
      body += b"\x00\xff\x51\x03" + (500000).to_bytes(3, "big")
    if name is not None:
      body += b"\x00\xff\x03" + varLen(len(name)) + name.encode("latin-1")
    for note in notes:
      body += varLen(480) + bytes([0x90, note, 100]) + varLen(240) + bytes([0x80, note, 0])
    body += b"\x00\xff\x2f\x00"
    chunks.append(b"MTrk" + len(body).to_bytes(4, "big") + body)
  return b"".join(chunks)


class TrackSelectionTest(unittest.TestCase):
  def load(self, data):
    tmp = tempfile.mkdtemp()
    self.addCleanup(shutil.rmtree, tmp)
    noteFile = os.path.join(tmp, "notes.mid")
    with open(noteFile, "wb") as f:
      f.write(data)
    song = Song.Song(FakeEngine(), songPath("defy", "song.ini"), None, None, None, noteFile)
    notes = {}
    for difficulty, track in enumerate(song.tracks):
      notes[difficulty] = [e.number for t, e in track.allEvents if isinstance(e, Song.Note)]
    info = Song.SongInfo(songPath("defy", "song.ini"), noteFile)
    return Song.findGuitarTrack(noteFile), notes, [d.id for d in info.difficulties]

  def testRockBandLayout(self):
    track, notes, diffs = self.load(midiFile([
      ("rawksd", []),
      ("PART DRUMS", [0x60, 0x60, 0x48]),
      ("PART BASS", [0x3c]),
      ("PART GUITAR", [0x61, 0x62, 0x54]),
      ("EVENTS", []),
    ]))
    self.assertEqual(track, 3)
    self.assertEqual(notes[Song.AMAZING_DIFFICULTY], [1, 2])
    self.assertEqual(notes[Song.MEDIUM_DIFFICULTY], [0])
    self.assertEqual(notes[Song.EASY_DIFFICULTY], [])
    self.assertEqual(diffs, [Song.MEDIUM_DIFFICULTY, Song.AMAZING_DIFFICULTY])

  def testLegacyTrackNames(self):
    track, notes, _ = self.load(midiFile([("song", []), ("t1 gems", [0x60]), ("TRIGGERS", [0x61])]))
    self.assertEqual(track, 1)
    self.assertEqual(notes[Song.AMAZING_DIFFICULTY], [0])

  def testUnnamedFallsBackToFirstTracks(self):
    track, notes, diffs = self.load(midiFile([(None, [0x60]), ("", [0x54]), (None, [0x48])]))
    self.assertIsNone(track)
    self.assertEqual(notes[Song.AMAZING_DIFFICULTY], [0])
    self.assertEqual(notes[Song.MEDIUM_DIFFICULTY], [0])
    self.assertEqual(notes[Song.EASY_DIFFICULTY], [])
    self.assertEqual(diffs, [Song.MEDIUM_DIFFICULTY, Song.AMAZING_DIFFICULTY])

  def testFormatZero(self):
    track, notes, _ = self.load(midiFile([(None, [0x60, 0x61])], format = 0))
    self.assertIsNone(track)
    self.assertEqual(notes[Song.AMAZING_DIFFICULTY], [0, 1])


class HighscoreTest(unittest.TestCase):
  def testCerealizerFormat(self):
    data = {1: [(1000, 3, "Player \u00e4", "abc")]}
    blob = Cerealizer.dumps(data)
    self.assertIsInstance(blob, bytes)
    self.assertTrue(blob.startswith(b"cereal1\n"))
    self.assertEqual(Cerealizer.loads(blob), data)

  def testPython2Blob(self):
    # {0: [(12, 2, 'ab', 'h')]} as written by the original Python 2 game.
    blob = b"cereal1\n3\ndict\nlist\ntuple\n4\ni12\ni2\ns2\nabs1\nh1\nr1\ni0\n1\nr2\nr0\n"
    self.assertEqual(Cerealizer.loads(blob), {0: [(12, 2, "ab", "h")]})

  def testScoresPersist(self):
    tmp = tempfile.mkdtemp()
    try:
      infoFile = os.path.join(tmp, "song.ini")
      shutil.copy(songPath("defy", "song.ini"), infoFile)
      info = Song.SongInfo(infoFile)
      difficulty = Song.difficulties[Song.EASY_DIFFICULTY]
      info.addHighscore(difficulty, 500, 3, "A")
      info.addHighscore(difficulty, 900, 4, "B")
      info.save()
      again = Song.SongInfo(infoFile)
      self.assertEqual(again.getHighscores(difficulty), [(900, 4, "B"), (500, 3, "A")])
    finally:
      shutil.rmtree(tmp)


class ConfigTest(unittest.TestCase):
  def testWriteAndRead(self):
    tmp = tempfile.mkdtemp()
    try:
      fileName = os.path.join(tmp, "test.ini")
      open(fileName, "w").close()
      proto = {}
      Config.define("video", "resolution", str, "640x480", prototype = proto)
      Config.define("game", "name", str, "", prototype = proto)
      c = Config.Config(proto, fileName)
      written = []
      Config.writeHooks.append(written.append)
      try:
        c.set("game", "name", "J\u00fcrgen 100%")
      finally:
        Config.writeHooks.remove(written.append)
      self.assertEqual(written, [fileName])
      self.assertEqual(Config.Config(proto, fileName).get("game", "name"), "J\u00fcrgen 100%")
    finally:
      shutil.rmtree(tmp)


class LoopbackTest(unittest.TestCase):
  def testPacketsAndClose(self):
    received = []
    closed = []

    class ServerConnection(Network.Connection):
      def handlePacket(self, packet):
        received.append(("server", packet))
        self.sendPacket(b"pong")

    class ClientConnection(Network.Connection):
      def handlePacket(self, packet):
        received.append(("client", packet))

      def handleClose(self):
        closed.append(self.id)
        Network.Connection.handleClose(self)

    class TestServer(Network.Server):
      def createConnection(self, sock):
        return ServerConnection(sock = sock)

    server = TestServer(port = 23456)
    try:
      client = ClientConnection()
      client.connect("127.0.0.1", 23456)
      self.assertEqual(client.id, 1)
      client.sendPacket(b"ping")
      Network.communicate()
      Network.communicate()
      self.assertEqual(received, [("server", b"ping"), ("client", b"pong")])
      server.close()
      Network.communicate()
      self.assertEqual(closed, [1])
    finally:
      Network.shutdown()

  def testRemoteHostRejected(self):
    with self.assertRaises(IOError):
      Network.Connection().connect("example.com")
    Network.shutdown()


if __name__ == "__main__":
  unittest.main()
