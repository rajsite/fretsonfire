#!/usr/bin/python
# -*- coding: iso-8859-1 -*-
#####################################################################
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

"""
Main game executable.
"""
import sys
import os

from GameEngine import GameEngine
from MainMenu import MainMenu
import Log
import Config
import Version
import getopt

usage = """%(prog)s [options]
Options:
  --verbose, -v         Verbose messages
  --play, -p [songName] Start playing the given song
""" % {"prog": sys.argv[0] }

if __name__ == "__main__":
  try:
    opts, args = getopt.getopt(sys.argv[1:], "vp:", ["verbose", "play="])
  except getopt.GetoptError:
    print(usage)
    sys.exit(1)

  songName = None
  for opt, arg in opts:
    if opt in ["--verbose", "-v"]:
      Log.quiet = False
    elif opt in ["--play", "-p"]:
      songName = arg

  while True:
    config = Config.load(Version.appName() + ".ini", setAsDefault = True)
    engine = GameEngine(config)
    menu   = MainMenu(engine, songName = songName)
    engine.setStartupLayer(menu)

    try:
      while engine.run():
        pass
    except KeyboardInterrupt:
        pass

    if engine.restartRequested:
      Log.notice("Restarting.")

      try:
        # Determine whether were running from an exe or not
        if hasattr(sys, "frozen"):
          if os.name == "nt":
            os.execl("FretsOnFire.exe", "FretsOnFire.exe", *sys.argv[1:])
          elif sys.platform == "darwin":
            # This exit code tells the launcher script to restart the game
            sys.exit(100)
          else:
            os.execl("./FretsOnFire", "./FretsOnFire", *sys.argv[1:])
        else:
          os.execl(sys.executable, sys.executable, "FretsOnFire.py", *sys.argv[1:])
      except:
        Log.warn("Restart failed.")
        raise
      break
    else:
      break
  engine.quit()
