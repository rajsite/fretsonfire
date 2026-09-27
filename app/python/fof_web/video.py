"""Browser video: the canvas, frame presentation and fullscreen for Video.py."""
from OpenGL import GL

import fofjs
from fof_web import frame

MODES = [(1920, 1080), (1600, 900), (1280, 960), (1280, 720), (1024, 768), (800, 600), (640, 480)]


def setMode(resolution, fullscreen = False, multisamples = 0):
  width, height = [int(v) for v in resolution]
  GL.platformInit(width, height)
  frame.add_flush_hook(GL.flush)
  fofjs.setVideoMode(width, height)
  return (width, height)


def flip():
  frame.flip()


def toggleFullscreen():
  fofjs.toggleFullscreen()
  return True


def listModes():
  return list(MODES)
