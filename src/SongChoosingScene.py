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

from Scene import SceneServer, SceneClient
import Player
import Dialogs
import Song
import Config
from Language import _

# save chosen song into config file
Config.define("game", "selected_library",  str, "")
Config.define("game", "selected_song",     str, "")

TOO_LONG = _("This song is too long for the browser version.")

class SongChoosingScene:
  pass

class SongChoosingSceneServer(SongChoosingScene, SceneServer):
  pass

class SongChoosingSceneClient(SongChoosingScene, SceneClient):
  def createClient(self, libraryName = None, songName = None):
    self.wizardStarted = False
    self.libraryName   = libraryName
    self.songName      = songName

  def run(self, ticks):
    SceneClient.run(self, ticks)

    if not self.wizardStarted:
      self.wizardStarted = True

      if not self.songName:
        while True:
          self.libraryName, self.songName = \
            Dialogs.chooseSong(self.engine, \
                               selectedLibrary = Config.get("game", "selected_library"),
                               selectedSong    = Config.get("game", "selected_song"))
        
          if not self.songName:
            self.session.world.finishGame()
            return

          Config.set("game", "selected_library", self.libraryName)
          Config.set("game", "selected_song",    self.songName)

          if Song.isSongTooLong(self.engine, self.songName, library = self.libraryName):
            Dialogs.showMessage(self.engine, TOO_LONG)
            continue
          
          info = Song.loadSongInfo(self.engine, self.songName, library = self.libraryName)
          d = Dialogs.chooseItem(self.engine, info.difficulties,
                                 _("Choose a difficulty:"), selected = self.player.difficulty)
          if d:
            self.player.difficulty = d
            break
      else:
        if Song.isSongTooLong(self.engine, self.songName, library = self.libraryName):
          Dialogs.showMessage(self.engine, TOO_LONG)
          self.session.world.finishGame()
          return
        info = Song.loadSongInfo(self.engine, self.songName, library = self.libraryName)

      # Make sure the difficulty we chose is available
      if not self.player.difficulty in info.difficulties:
        self.player.difficulty = info.difficulties[0]
        
      self.session.world.deleteScene(self)
      self.session.world.createScene("GuitarScene", libraryName = self.libraryName, songName = self.songName)
