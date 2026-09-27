"""Page 04: fixed-function emulation scenes rendered through the game's own Texture, Svg and Mesh classes."""
import json
import math
import time

import numpy

from OpenGL.GL import *
from OpenGL.GLU import *
from OpenGL import GL as _gl

W, H = 640, 480


def ortho():
  glMatrixMode(GL_PROJECTION)
  glLoadIdentity()
  glOrtho(0, W, 0, H, -100, 100)
  glMatrixMode(GL_MODELVIEW)
  glLoadIdentity()


def clear(r = 0.1, g = 0.1, b = 0.15):
  glDepthMask(1)
  glClearColor(r, g, b, 1)
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)


def scenePrimitives():
  clear()
  ortho()
  glBegin(GL_TRIANGLES)
  glColor3f(1, 0, 0); glVertex2f(40, 40)
  glColor3f(0, 1, 0); glVertex2f(200, 40)
  glColor3f(0, 0, 1); glVertex2f(120, 200)
  glEnd()
  glColor4f(1, 1, 0, 1)
  glBegin(GL_TRIANGLE_STRIP)
  glVertex2f(240, 40); glVertex2f(400, 40); glVertex2f(240, 200); glVertex2f(400, 200)
  glEnd()
  glBegin(GL_QUADS)
  glColor3f(0, 1, 1); glVertex2f(440, 40); glVertex2f(600, 40)
  glColor3f(1, 0, 1); glVertex2f(600, 200); glVertex2f(440, 200)
  glEnd()
  glColor3f(1, 1, 1)
  glBegin(GL_LINE_LOOP)
  glVertex2f(40, 260); glVertex2f(600, 260); glVertex2f(600, 440); glVertex2f(40, 440)
  glEnd()
  glEnable(GL_BLEND)
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
  glColor4f(1, 1, 1, 0.5)
  glBegin(GL_POLYGON)
  for i in range(6):
    a = i * math.pi / 3
    glVertex2f(320 + 80 * math.cos(a), 350 + 80 * math.sin(a))
  glEnd()
  glDisable(GL_BLEND)


def sceneTexture():
  from Texture import Texture
  clear()
  ortho()
  tex = Texture("../data/logo.png")
  glEnable(GL_TEXTURE_2D)
  glEnable(GL_BLEND)
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
  tex.bind()
  for i, (x, alpha) in enumerate([(20, 1.0), (330, 0.5)]):
    glMatrixMode(GL_TEXTURE)
    glPushMatrix()
    if i == 1:
      glScalef(2, 2, 1)
    glMatrixMode(GL_MODELVIEW)
    glColor4f(1, 1, 1, alpha)
    glBegin(GL_TRIANGLE_STRIP)
    glTexCoord2f(0, 1); glVertex2f(x, 400)
    glTexCoord2f(1, 1); glVertex2f(x + 290, 400)
    glTexCoord2f(0, 0); glVertex2f(x, 100)
    glTexCoord2f(1, 0); glVertex2f(x + 290, 100)
    glEnd()
    glMatrixMode(GL_TEXTURE)
    glPopMatrix()
    glMatrixMode(GL_MODELVIEW)
  glDisable(GL_TEXTURE_2D)
  return {"textureSize": tex.pixelSize}


def sceneSvg():
  import Svg
  clear(0.3, 0.05, 0.05)
  ctx = Svg.SvgContext((0, 0, W, H))
  drawing = Svg.SvgDrawing(ctx, "../data/keyboard.svg")
  glEnable(GL_BLEND)
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
  drawing.transform.translate(W / 2, H / 2)
  drawing.transform.rotate(-0.3)
  drawing.transform.scale(1.5, 1.5)
  drawing.draw(color = (1, 1, 1, 0.8))
  logo = Svg.SvgDrawing(ctx, "../data/logo.png")
  logo.transform.translate(W / 2, 0.8 * H)
  logo.transform.scale(1, -1)
  logo.draw()


def sceneDepth():
  clear()
  glMatrixMode(GL_PROJECTION)
  glLoadIdentity()
  gluPerspective(60, W / float(H), 0.1, 100)
  glMatrixMode(GL_MODELVIEW)
  glLoadIdentity()
  gluLookAt(0, 2, 6, 0, 0, 0, 0, 1, 0)
  glEnable(GL_DEPTH_TEST)
  for z, color in [(-1, (1, 0, 0)), (0, (0, 1, 0)), (1, (0, 0, 1))]:
    glPushMatrix()
    glTranslatef(z * 0.8, 0, z)
    glRotatef(20 * z, 0, 1, 0)
    glColor3f(*color)
    glBegin(GL_QUADS)
    glVertex3f(-1, -1, 0); glVertex3f(1, -1, 0); glVertex3f(1, 1, 0); glVertex3f(-1, 1, 0)
    glEnd()
    glPopMatrix()
  glDisable(GL_DEPTH_TEST)


def sceneMesh():
  from Mesh import Mesh
  clear()
  glEnable(GL_COLOR_MATERIAL)
  glMatrixMode(GL_PROJECTION)
  glLoadIdentity()
  gluPerspective(60, W / float(H), 0.1, 1000)
  glMatrixMode(GL_MODELVIEW)
  glLoadIdentity()
  gluLookAt(0, 3, 4, 0, 0, 0, 0, 1, 0)
  note = Mesh("../data/note.dae")
  key = Mesh("../data/key.dae")
  glEnable(GL_DEPTH_TEST)
  glDepthMask(1)
  glShadeModel(GL_SMOOTH)
  colors = [(0, 1, 0), (1, 0, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1)]
  for i, c in enumerate(colors):
    glPushMatrix()
    glTranslatef((i - 2) * 0.9, 0, 0)
    glColor4f(.1 + .8 * c[0], .1 + .8 * c[1], .1 + .8 * c[2], 1)
    key.render("Mesh_001")
    glColor4f(.25 * c[0], .25 * c[1], .25 * c[2], 1)
    key.render("Mesh")
    glTranslatef(0, 0, -1.5)
    glColor4f(.1 + .8 * c[0], .1 + .8 * c[1], .1 + .8 * c[2], 1)
    note.render("Mesh_001")
    glColor4f(.75 * c[0], .75 * c[1], .75 * c[2], 1)
    note.render("Mesh")
    glColor4f(.25 * c[0], .25 * c[1], .25 * c[2], 1)
    note.render("Mesh_002")
    glPopMatrix()
  glDepthMask(0)
  glDisable(GL_DEPTH_TEST)


def sceneArrays():
  clear()
  ortho()
  n = 64
  vertices = numpy.empty((n * 2, 3), numpy.float32)
  colors = numpy.empty((n * 2, 4), numpy.float32)
  for i in range(n):
    x = 20 + i * 600.0 / (n - 1)
    y = 240 + 120 * math.sin(i / 6.0)
    vertices[2 * i] = (x, y - 30, 0)
    vertices[2 * i + 1] = (x, y + 30, 0)
    colors[2 * i] = (i / float(n), 0.2, 1 - i / float(n), 1)
    colors[2 * i + 1] = (1, 1, 1, 0.3)
  glEnable(GL_BLEND)
  glBlendFunc(GL_SRC_ALPHA, GL_ONE)
  glEnableClientState(GL_VERTEX_ARRAY)
  glEnableClientState(GL_COLOR_ARRAY)
  glVertexPointer(3, GL_FLOAT, 0, vertices)
  glColorPointer(4, GL_FLOAT, 0, colors)
  glDrawArrays(GL_TRIANGLE_STRIP, 0, n * 2)
  glDisableClientState(GL_VERTEX_ARRAY)
  glDisableClientState(GL_COLOR_ARRAY)
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
  glDisable(GL_BLEND)


def sceneFont():
  import pygame
  from Font import Font
  from Texture import Texture
  pygame.font.init()
  clear(0.2, 0.05, 0.05)
  glMatrixMode(GL_PROJECTION)
  glLoadIdentity()
  # Same normalized projection as View.setOrthogonalProjection (y down, 4:3).
  glOrtho(0, 1, 0.75, 0, -100, 100)
  glMatrixMode(GL_MODELVIEW)
  glLoadIdentity()
  glEnable(GL_BLEND)
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
  font = Font("../data/default.ttf", 22)
  big = Font("../data/title.ttf", 108)
  intl = Font("../data/international.ttf", 22)
  font.setCustomGlyph("\x10", Texture("../data/star1.png"))
  font.setCustomGlyph("\x11", Texture("../data/star2.png"))
  glColor4f(1, 0.9, 0.5, 1)
  big.render("Frets on Fire", (0.05, 0.05), scale = 0.0025)
  glColor4f(1, 1, 1, 1)
  font.render("Play Game  Tutorial  Settings >", (0.05, 0.3))
  font.render("Stars: \x11\x11\x11\x10\x10", (0.05, 0.4))
  glColor4f(0.6, 0.9, 1, 1)
  intl.render("\u00c4\u00e4\u00d6\u00f6 \u00e9\u00e8 \u0416\u0438\u0437\u043d\u044c \u0141\u00f3d\u017a", (0.05, 0.5))
  glColor4f(1, 1, 1, 0.5)
  font.render("half transparent", (0.05, 0.6))
  glDisable(GL_BLEND)
  return {"glyphTextures": len(font.glyphTextures)}


SCENES = {
  "primitives": scenePrimitives,
  "texture": sceneTexture,
  "svg": sceneSvg,
  "depth": sceneDepth,
  "mesh": sceneMesh,
  "arrays": sceneArrays,
  "font": sceneFont,
}


def run(scene):
  import Config
  import Version
  Config.load(Version.appName() + ".ini", setAsDefault = True)
  _gl.platformInit(W, H)
  t0 = time.perf_counter()
  info = SCENES[scene]() or {}
  stats = _gl.frameStats()
  _gl.flush()
  info.update(stats)
  info["pythonMs"] = (time.perf_counter() - t0) * 1000
  return json.dumps(info)
