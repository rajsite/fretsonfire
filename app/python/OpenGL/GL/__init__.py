"""
Fixed-function OpenGL 1.x emulation on top of a WebGL2 backend.

All state lives in Python so queries never round-trip to JavaScript. Geometry
from immediate mode and client arrays is appended to a per-frame vertex arena
(12 floats per vertex: position, color, texcoord, normal) and every draw call is
encoded, together with the state it needs, into a float command stream. Both
buffers are handed to the backend once per frame by flush().
"""
import math
from array import array

import numpy

# --- Constants (values from the OpenGL specification) -----------------------

GL_FALSE = 0
GL_TRUE = 1
GL_NO_ERROR = 0

GL_POINTS = 0x0000
GL_LINES = 0x0001
GL_LINE_LOOP = 0x0002
GL_LINE_STRIP = 0x0003
GL_TRIANGLES = 0x0004
GL_TRIANGLE_STRIP = 0x0005
GL_TRIANGLE_FAN = 0x0006
GL_QUADS = 0x0007
GL_QUAD_STRIP = 0x0008
GL_POLYGON = 0x0009

GL_MODELVIEW = 0x1700
GL_PROJECTION = 0x1701
GL_TEXTURE = 0x1702

GL_POINT_SMOOTH = 0x0B10
GL_LINE_SMOOTH = 0x0B20
GL_POLYGON_SMOOTH = 0x0B41
GL_CULL_FACE = 0x0B44
GL_LIGHTING = 0x0B50
GL_COLOR_MATERIAL = 0x0B57
GL_FOG = 0x0B60
GL_DEPTH_TEST = 0x0B71
GL_STENCIL_TEST = 0x0B90
GL_NORMALIZE = 0x0BA1
GL_ALPHA_TEST = 0x0BC0
GL_DITHER = 0x0BD0
GL_BLEND = 0x0BE2
GL_SCISSOR_TEST = 0x0C11
GL_TEXTURE_2D = 0x0DE1
GL_MULTISAMPLE = 0x809D
GL_LIGHT0 = 0x4000
GL_LIGHT1 = 0x4001
GL_LIGHT2 = 0x4002
GL_LIGHT3 = 0x4003
GL_LIGHT4 = 0x4004
GL_LIGHT5 = 0x4005
GL_LIGHT6 = 0x4006
GL_LIGHT7 = 0x4007

GL_ZERO = 0
GL_ONE = 1
GL_SRC_COLOR = 0x0300
GL_ONE_MINUS_SRC_COLOR = 0x0301
GL_SRC_ALPHA = 0x0302
GL_ONE_MINUS_SRC_ALPHA = 0x0303
GL_DST_ALPHA = 0x0304
GL_ONE_MINUS_DST_ALPHA = 0x0305
GL_DST_COLOR = 0x0306
GL_ONE_MINUS_DST_COLOR = 0x0307
GL_SRC_ALPHA_SATURATE = 0x0308

GL_NEVER = 0x0200
GL_LESS = 0x0201
GL_EQUAL = 0x0202
GL_LEQUAL = 0x0203
GL_GREATER = 0x0204
GL_NOTEQUAL = 0x0205
GL_GEQUAL = 0x0206
GL_ALWAYS = 0x0207

GL_CURRENT_BIT = 0x00000001
GL_POINT_BIT = 0x00000002
GL_LINE_BIT = 0x00000004
GL_POLYGON_BIT = 0x00000008
GL_POLYGON_STIPPLE_BIT = 0x00000010
GL_PIXEL_MODE_BIT = 0x00000020
GL_LIGHTING_BIT = 0x00000040
GL_FOG_BIT = 0x00000080
GL_DEPTH_BUFFER_BIT = 0x00000100
GL_ACCUM_BUFFER_BIT = 0x00000200
GL_STENCIL_BUFFER_BIT = 0x00000400
GL_VIEWPORT_BIT = 0x00000800
GL_TRANSFORM_BIT = 0x00001000
GL_ENABLE_BIT = 0x00002000
GL_COLOR_BUFFER_BIT = 0x00004000
GL_HINT_BIT = 0x00008000
GL_EVAL_BIT = 0x00010000
GL_LIST_BIT = 0x00020000
GL_TEXTURE_BIT = 0x00040000
GL_SCISSOR_BIT = 0x00080000
GL_ALL_ATTRIB_BITS = 0xFFFFFFFF

GL_BYTE = 0x1400
GL_UNSIGNED_BYTE = 0x1401
GL_SHORT = 0x1402
GL_UNSIGNED_SHORT = 0x1403
GL_INT = 0x1404
GL_UNSIGNED_INT = 0x1405
GL_FLOAT = 0x1406
GL_DOUBLE = 0x140A

GL_STENCIL_INDEX = 0x1901
GL_DEPTH_COMPONENT = 0x1902
GL_ALPHA = 0x1906
GL_RGB = 0x1907
GL_RGBA = 0x1908
GL_LUMINANCE = 0x1909
GL_LUMINANCE_ALPHA = 0x190A
GL_ALPHA8 = 0x803C
GL_LUMINANCE8 = 0x8040
GL_INTENSITY = 0x8049
GL_INTENSITY8 = 0x804B
GL_RGB8 = 0x8051
GL_RGBA8 = 0x8058

GL_TEXTURE_MAG_FILTER = 0x2800
GL_TEXTURE_MIN_FILTER = 0x2801
GL_TEXTURE_WRAP_S = 0x2802
GL_TEXTURE_WRAP_T = 0x2803
GL_NEAREST = 0x2600
GL_LINEAR = 0x2601
GL_NEAREST_MIPMAP_NEAREST = 0x2700
GL_LINEAR_MIPMAP_NEAREST = 0x2701
GL_NEAREST_MIPMAP_LINEAR = 0x2702
GL_LINEAR_MIPMAP_LINEAR = 0x2703
GL_CLAMP = 0x2900
GL_REPEAT = 0x2901
GL_CLAMP_TO_EDGE = 0x812F

GL_TEXTURE_ENV = 0x2300
GL_TEXTURE_ENV_MODE = 0x2200
GL_MODULATE = 0x2100
GL_DECAL = 0x2101
GL_REPLACE = 0x1E01
GL_ADD = 0x0104

GL_UNPACK_ALIGNMENT = 0x0CF5
GL_PACK_ALIGNMENT = 0x0D05

GL_DONT_CARE = 0x1100
GL_FASTEST = 0x1101
GL_NICEST = 0x1102
GL_PERSPECTIVE_CORRECTION_HINT = 0x0C50
GL_POINT_SMOOTH_HINT = 0x0C51
GL_LINE_SMOOTH_HINT = 0x0C52
GL_POLYGON_SMOOTH_HINT = 0x0C53

GL_CURRENT_COLOR = 0x0B00
GL_MATRIX_MODE = 0x0BA0
GL_VIEWPORT = 0x0BA2
GL_MODELVIEW_MATRIX = 0x0BA6
GL_PROJECTION_MATRIX = 0x0BA7
GL_TEXTURE_MATRIX = 0x0BA8
GL_SCISSOR_BOX = 0x0C10
GL_MAX_TEXTURE_SIZE = 0x0D33
GL_DEPTH_WRITEMASK = 0x0B72
GL_BLEND_DST = 0x0BE0
GL_BLEND_SRC = 0x0BE1
GL_VENDOR = 0x1F00
GL_RENDERER = 0x1F01
GL_VERSION = 0x1F02
GL_EXTENSIONS = 0x1F03

GL_FRONT = 0x0404
GL_BACK = 0x0405
GL_FRONT_AND_BACK = 0x0408
GL_CW = 0x0900
GL_CCW = 0x0901

GL_AMBIENT = 0x1200
GL_DIFFUSE = 0x1201
GL_SPECULAR = 0x1202
GL_POSITION = 0x1203
GL_SPOT_DIRECTION = 0x1204
GL_SPOT_EXPONENT = 0x1205
GL_SPOT_CUTOFF = 0x1206
GL_CONSTANT_ATTENUATION = 0x1207
GL_LINEAR_ATTENUATION = 0x1208
GL_QUADRATIC_ATTENUATION = 0x1209
GL_EMISSION = 0x1600
GL_SHININESS = 0x1601
GL_AMBIENT_AND_DIFFUSE = 0x1602
GL_LIGHT_MODEL_AMBIENT = 0x0B53
GL_LIGHT_MODEL_TWO_SIDE = 0x0B52

GL_FLAT = 0x1D00
GL_SMOOTH = 0x1D01

GL_COMPILE = 0x1300
GL_COMPILE_AND_EXECUTE = 0x1301

GL_VERTEX_ARRAY = 0x8074
GL_NORMAL_ARRAY = 0x8075
GL_COLOR_ARRAY = 0x8076
GL_TEXTURE_COORD_ARRAY = 0x8078

GL_FRAMEBUFFER_EXT = 0x8D40
GL_RENDERBUFFER_EXT = 0x8D41
GL_COLOR_ATTACHMENT0_EXT = 0x8CE0
GL_DEPTH_ATTACHMENT_EXT = 0x8D00
GL_STENCIL_ATTACHMENT_EXT = 0x8D20
GL_DEPTH_COMPONENT24 = 0x81A6
GL_STENCIL_INDEX_EXT = 0x8D45

# --- Command stream encoding (must match src/gl/backend.ts) -----------------

OP_DRAW = 1
OP_VIEWPORT = 2
OP_SCISSOR = 3
OP_CLEAR = 4
OP_DELETE_TEXTURE = 5
OP_DELETE_STATIC = 6

F_BLEND = 1
F_DEPTH_TEST = 2
F_DEPTH_MASK = 4
F_TEXTURE = 8
F_CULL = 16
F_LIGHTING = 32
F_COLOR_MATERIAL = 64
F_SCISSOR = 128
F_VCOLOR = 256
F_VTEX = 512
F_VNORMAL = 1024
F_TEXMATRIX = 2048
F_STATIC = 4096
F_NORMALIZE = 8192

VERTEX_FLOATS = 12
MAX_TEXTURE_SIZE = 2048

_ENABLE_FLAGS = {
  GL_BLEND: F_BLEND,
  GL_DEPTH_TEST: F_DEPTH_TEST,
  GL_TEXTURE_2D: F_TEXTURE,
  GL_CULL_FACE: F_CULL,
  GL_LIGHTING: F_LIGHTING,
  GL_COLOR_MATERIAL: F_COLOR_MATERIAL,
  GL_SCISSOR_TEST: F_SCISSOR,
  GL_NORMALIZE: F_NORMALIZE,
}

# --- Matrix helpers (column-major 16-element lists) -------------------------

_IDENTITY = (1.0, 0.0, 0.0, 0.0,
             0.0, 1.0, 0.0, 0.0,
             0.0, 0.0, 1.0, 0.0,
             0.0, 0.0, 0.0, 1.0)
_IDENTITY_LIST = list(_IDENTITY)


def _mul(a, b):
  a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15 = a
  out = []
  for c in range(0, 16, 4):
    b0, b1, b2, b3 = b[c], b[c + 1], b[c + 2], b[c + 3]
    out.append(a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3)
    out.append(a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3)
    out.append(a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3)
    out.append(a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3)
  return out


def _normalMatrix(m):
  """Inverse transpose of the upper 3x3 of a column-major 4x4 matrix, as a column-major 3x3."""
  a, b, c = m[0], m[4], m[8]
  d, e, f = m[1], m[5], m[9]
  g, h, i = m[2], m[6], m[10]
  A = e * i - f * h
  B = -(d * i - f * g)
  C = d * h - e * g
  det = a * A + b * B + c * C
  if abs(det) < 1e-12:
    return (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
  inv = 1.0 / det
  # Inverse transpose equals the cofactor matrix divided by the determinant.
  return (A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
          B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
          C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv)


def _flatMatrix(m):
  m = numpy.asarray(m, dtype = numpy.float64).reshape(-1)
  if m.size != 16:
    raise ValueError("Expected a 4x4 matrix")
  return [float(v) for v in m]


# --- Backend ---------------------------------------------------------------

class _NullBackend(object):
  """Used when no WebGL backend is registered (unit tests)."""
  def __getattr__(self, name):
    return lambda *args: None


def _loadBackend():
  try:
    import fofgl
    return fofgl
  except ImportError:
    return _NullBackend()


_backend = _loadBackend()


# --- State -----------------------------------------------------------------

class _Light(object):
  __slots__ = ("direction", "diffuse", "ambient", "specular")

  def __init__(self, n):
    self.direction = (0.0, 0.0, 1.0)
    self.diffuse = (1.0, 1.0, 1.0, 1.0) if n == 0 else (0.0, 0.0, 0.0, 1.0)
    self.specular = self.diffuse
    self.ambient = (0.0, 0.0, 0.0, 1.0)


class _DisplayList(object):
  __slots__ = ("commands", "vertices", "vbo")

  def __init__(self):
    self.commands = []
    self.vertices = array("f")
    self.vbo = 0


class _State(object):
  def __init__(self):
    self.stacks = {GL_MODELVIEW: [list(_IDENTITY)], GL_PROJECTION: [list(_IDENTITY)], GL_TEXTURE: [list(_IDENTITY)]}
    self.matrixMode = GL_MODELVIEW
    self.current = self.stacks[GL_MODELVIEW]
    self.mvp = None
    self.color = (1.0, 1.0, 1.0, 1.0)
    self.texcoord = (0.0, 0.0)
    self.normal = (0.0, 0.0, 1.0)
    self.enabled = set([GL_DITHER, GL_MULTISAMPLE])
    self.flags = 0
    self.blendSrc = GL_ONE
    self.blendDst = GL_ZERO
    self.depthMask = True
    self.viewport = (0, 0, 640, 480)
    self.scissor = (0, 0, 640, 480)
    self.clearColor = (0.0, 0.0, 0.0, 0.0)
    self.texture = 0
    self.texEnv = GL_MODULATE
    self.lights = [_Light(n) for n in range(8)]
    self.sceneAmbient = (0.2, 0.2, 0.2, 1.0)
    self.matAmbient = (0.2, 0.2, 0.2, 1.0)
    self.matDiffuse = (0.8, 0.8, 0.8, 1.0)
    self.matSpecular = (0.0, 0.0, 0.0, 1.0)
    self.shininess = 0.0
    self.arrays = {GL_VERTEX_ARRAY: None, GL_COLOR_ARRAY: None, GL_TEXTURE_COORD_ARRAY: None, GL_NORMAL_ARRAY: None}
    self.arraysEnabled = set()
    self.attribStack = []
    self.lists = {}
    self.nextList = 1
    self.compiling = None
    self.compileMode = GL_COMPILE
    self.inBegin = False
    self.beginMode = 0
    self.beginFirst = 0
    self.beginAttrs = 0
    self.target = None
    self.nextTexture = 1
    self.textureSizes = {}
    self.nextVbo = 1
    self.arena = array("f")
    self.commands = array("f")


_s = _State()


def _record(fn, *args):
  # GL_COMPILE_AND_EXECUTE lists are executed once by glEndList instead of while compiling.
  _s.compiling.commands.append((fn, args))
  return True


def _setEnabled(cap, enabled):
  if enabled:
    _s.enabled.add(cap)
  else:
    _s.enabled.discard(cap)
  flag = _ENABLE_FLAGS.get(cap)
  if flag:
    if enabled:
      _s.flags |= flag
    else:
      _s.flags &= ~flag


def _matrixChanged():
  if _s.matrixMode != GL_TEXTURE:
    _s.mvp = None


def _top():
  return _s.current[-1]


def _setTop(m):
  _s.current[-1] = m
  _matrixChanged()


# --- Frame management (called by the platform layer) ------------------------

def platformInit(width, height):
  """Reset the default framebuffer geometry after the canvas has been sized."""
  _s.viewport = (0, 0, int(width), int(height))
  _s.scissor = (0, 0, int(width), int(height))
  _backend.init(int(width), int(height))
  _s.commands.extend((OP_VIEWPORT, 0, 0, width, height, OP_SCISSOR, 0, 0, width, height))


def flush():
  """Hand the frame's vertices and commands to the backend."""
  arena, commands = _s.arena, _s.commands
  if commands:
    _backend.executeFrame(arena, commands, len(commands))
  _s.arena = array("f")
  _s.commands = array("f")


def frameStats():
  return {"vertices": len(_s.arena) // VERTEX_FLOATS, "commandFloats": len(_s.commands)}


# --- Draw emission ---------------------------------------------------------

def _emitDraw(mode, first, count, attrFlags, vbo = 0):
  if count <= 0:
    return
  s = _s
  flags = s.flags | attrFlags
  if s.depthMask:
    flags |= F_DEPTH_MASK
  if vbo:
    flags |= F_STATIC
  texMatrix = None
  if flags & F_TEXTURE:
    texMatrix = s.stacks[GL_TEXTURE][-1]
    if texMatrix != _IDENTITY_LIST:
      flags |= F_TEXMATRIX
  if s.mvp is None:
    s.mvp = _mul(s.stacks[GL_PROJECTION][-1], s.stacks[GL_MODELVIEW][-1])
  c = s.color
  cmd = s.commands
  cmd.extend((OP_DRAW, mode, first, count, flags, s.blendSrc, s.blendDst, s.texture, s.texEnv, vbo,
              c[0], c[1], c[2], c[3], s.texcoord[0], s.texcoord[1], s.normal[0], s.normal[1], s.normal[2]))
  cmd.extend(s.mvp)
  if flags & F_TEXMATRIX:
    cmd.extend(texMatrix)
  if flags & F_LIGHTING:
    cmd.extend(_normalMatrix(s.stacks[GL_MODELVIEW][-1]))
    cmd.extend(s.sceneAmbient)
    cmd.extend(s.matAmbient)
    cmd.extend(s.matDiffuse)
    lights = [s.lights[n] for n in range(8) if (GL_LIGHT0 + n) in s.enabled]
    cmd.append(len(lights))
    for light in lights:
      cmd.extend(light.direction)
      cmd.extend(light.diffuse)
      cmd.extend(light.ambient)


def _expandQuads(data, first, count):
  """Rewrite count quad vertices starting at vertex 'first' of 'data' as triangles."""
  n = count - count % 4
  base = first * VERTEX_FLOATS
  view = numpy.frombuffer(data, dtype = numpy.float32, count = n * VERTEX_FLOATS, offset = base * 4)
  tris = view.reshape(-1, 4, VERTEX_FLOATS)[:, (0, 1, 2, 0, 2, 3), :].tobytes()
  # The array cannot be resized while numpy still holds its buffer.
  del view
  del data[base:]
  data.frombytes(tris)
  return (n // 4) * 6


# --- Enable / state --------------------------------------------------------

def glEnable(cap):
  if _s.compiling is not None and _record(glEnable, cap):
    return
  _setEnabled(cap, True)


def glDisable(cap):
  if _s.compiling is not None and _record(glDisable, cap):
    return
  _setEnabled(cap, False)


def glIsEnabled(cap):
  return cap in _s.enabled


def glBlendFunc(src, dst):
  if _s.compiling is not None and _record(glBlendFunc, src, dst):
    return
  _s.blendSrc, _s.blendDst = src, dst


def glDepthMask(flag):
  if _s.compiling is not None and _record(glDepthMask, flag):
    return
  _s.depthMask = bool(flag)


def glDepthFunc(func):
  pass


def glShadeModel(mode):
  pass


def glHint(target, mode):
  pass


def glColorMaterial(face, mode):
  pass


def glCullFace(mode):
  pass


def glFrontFace(mode):
  pass


def glLineWidth(width):
  pass


def glPointSize(size):
  pass


def glFlush():
  pass


def glFinish():
  pass


def glGetError():
  return GL_NO_ERROR


def glViewport(x, y, width, height):
  _s.viewport = (int(x), int(y), int(width), int(height))
  _s.commands.extend((OP_VIEWPORT,) + _s.viewport)


def glScissor(x, y, width, height):
  _s.scissor = (int(x), int(y), int(width), int(height))
  _s.commands.extend((OP_SCISSOR,) + _s.scissor)


def glClearColor(r, g, b, a):
  _s.clearColor = (r, g, b, a)


def glClear(mask):
  c = _s.clearColor
  _s.commands.extend((OP_CLEAR, mask, c[0], c[1], c[2], c[3], 1 if GL_SCISSOR_TEST in _s.enabled else 0, 1 if _s.depthMask else 0))


# --- Current vertex attributes ---------------------------------------------

def glColor4f(r, g, b, a = 1.0):
  s = _s
  if s.inBegin:
    s.beginAttrs |= F_VCOLOR
  elif s.compiling is not None and _record(glColor4f, r, g, b, a):
    return
  s.color = (r, g, b, a)


def glColor3f(r, g, b):
  glColor4f(r, g, b, 1.0)


def glColor4fv(v):
  glColor4f(v[0], v[1], v[2], v[3])


def glColor3fv(v):
  glColor4f(v[0], v[1], v[2], 1.0)


def glColor(*args):
  if len(args) == 1:
    args = tuple(args[0])
  glColor4f(*args) if len(args) == 4 else glColor4f(args[0], args[1], args[2], 1.0)


glColor4d = glColor4f
glColor3d = glColor3f


def glTexCoord2f(s_, t):
  s = _s
  if s.inBegin:
    s.beginAttrs |= F_VTEX
  elif s.compiling is not None and _record(glTexCoord2f, s_, t):
    return
  s.texcoord = (s_, t)


def glTexCoord2fv(v):
  glTexCoord2f(v[0], v[1])


glTexCoord2d = glTexCoord2f


def glNormal3f(x, y, z):
  s = _s
  if s.inBegin:
    s.beginAttrs |= F_VNORMAL
  elif s.compiling is not None and _record(glNormal3f, x, y, z):
    return
  s.normal = (x, y, z)


def glNormal3fv(v):
  glNormal3f(v[0], v[1], v[2])


glNormal3d = glNormal3f


# --- Immediate mode --------------------------------------------------------

def glBegin(mode):
  s = _s
  s.inBegin = True
  s.beginMode = mode
  s.beginAttrs = 0
  s.target = s.compiling.vertices if s.compiling is not None else s.arena
  s.beginFirst = len(s.target) // VERTEX_FLOATS


def glVertex3f(x, y, z):
  s = _s
  c, t, n = s.color, s.texcoord, s.normal
  s.target.extend((x, y, z, c[0], c[1], c[2], c[3], t[0], t[1], n[0], n[1], n[2]))


def glVertex2f(x, y):
  s = _s
  c, t, n = s.color, s.texcoord, s.normal
  s.target.extend((x, y, 0.0, c[0], c[1], c[2], c[3], t[0], t[1], n[0], n[1], n[2]))


def glVertex3fv(v):
  glVertex3f(v[0], v[1], v[2])


def glVertex2fv(v):
  glVertex2f(v[0], v[1])


glVertex3d = glVertex3f
glVertex2d = glVertex2f


def glEnd():
  s = _s
  s.inBegin = False
  target = s.target
  s.target = None
  first = s.beginFirst
  count = len(target) // VERTEX_FLOATS - first
  mode = s.beginMode
  if mode == GL_QUADS:
    count = _expandQuads(target, first, count)
    mode = GL_TRIANGLES
  elif mode == GL_QUAD_STRIP:
    mode = GL_TRIANGLE_STRIP
  elif mode == GL_POLYGON:
    mode = GL_TRIANGLE_FAN
  if s.compiling is not None:
    s.compiling.commands.append(("draw", mode, first, count, s.beginAttrs))
    return
  _emitDraw(mode, first, count, s.beginAttrs)


# --- Client arrays ---------------------------------------------------------

def _setPointer(kind, size, type, stride, pointer):
  if type != GL_FLOAT:
    raise NotImplementedError("Only GL_FLOAT client arrays are supported")
  data = numpy.asarray(pointer, dtype = numpy.float32)
  if stride:
    raise NotImplementedError("Strided client arrays are not supported")
  _s.arrays[kind] = data.reshape(-1, size)


def glVertexPointer(size, type, stride, pointer):
  _setPointer(GL_VERTEX_ARRAY, size, type, stride, pointer)


def glColorPointer(size, type, stride, pointer):
  _setPointer(GL_COLOR_ARRAY, size, type, stride, pointer)


def glTexCoordPointer(size, type, stride, pointer):
  _setPointer(GL_TEXTURE_COORD_ARRAY, size, type, stride, pointer)


def glNormalPointer(type, stride, pointer):
  _setPointer(GL_NORMAL_ARRAY, 3, type, stride, pointer)


glVertexPointerf = lambda pointer: glVertexPointer(numpy.asarray(pointer).shape[-1], GL_FLOAT, 0, pointer)


def glEnableClientState(kind):
  _s.arraysEnabled.add(kind)


def glDisableClientState(kind):
  _s.arraysEnabled.discard(kind)


def glDrawArrays(mode, first, count):
  s = _s
  if count <= 0 or GL_VERTEX_ARRAY not in s.arraysEnabled:
    return
  out = numpy.empty((count, VERTEX_FLOATS), dtype = numpy.float32)
  v = s.arrays[GL_VERTEX_ARRAY][first:first + count]
  out[:, 0:v.shape[1]] = v
  if v.shape[1] == 2:
    out[:, 2] = 0.0
  attrs = 0
  c = s.arrays[GL_COLOR_ARRAY] if GL_COLOR_ARRAY in s.arraysEnabled else None
  if c is not None:
    c = c[first:first + count]
    out[:, 3:3 + c.shape[1]] = c
    if c.shape[1] == 3:
      out[:, 6] = 1.0
    attrs |= F_VCOLOR
  else:
    out[:, 3:7] = s.color
  t = s.arrays[GL_TEXTURE_COORD_ARRAY] if GL_TEXTURE_COORD_ARRAY in s.arraysEnabled else None
  if t is not None:
    out[:, 7:9] = t[first:first + count, 0:2]
    attrs |= F_VTEX
  else:
    out[:, 7:9] = s.texcoord
  n = s.arrays[GL_NORMAL_ARRAY] if GL_NORMAL_ARRAY in s.arraysEnabled else None
  if n is not None:
    out[:, 9:12] = n[first:first + count]
    attrs |= F_VNORMAL
  else:
    out[:, 9:12] = s.normal
  if mode == GL_QUADS:
    quads = count - count % 4
    out = out[:quads].reshape(-1, 4, VERTEX_FLOATS)[:, (0, 1, 2, 0, 2, 3), :].reshape(-1, VERTEX_FLOATS)
    mode, count = GL_TRIANGLES, len(out)
  elif mode == GL_POLYGON:
    mode = GL_TRIANGLE_FAN
  base = len(s.arena) // VERTEX_FLOATS
  s.arena.frombytes(out.tobytes())
  _emitDraw(mode, base, count, attrs)


# --- Matrices --------------------------------------------------------------

def glMatrixMode(mode):
  if _s.compiling is not None and _record(glMatrixMode, mode):
    return
  _s.matrixMode = mode
  _s.current = _s.stacks[mode]


def glLoadIdentity():
  if _s.compiling is not None and _record(glLoadIdentity):
    return
  _setTop(list(_IDENTITY))


def glLoadMatrixf(m):
  if _s.compiling is not None and _record(glLoadMatrixf, m):
    return
  _setTop(_flatMatrix(m))


def glPushMatrix():
  if _s.compiling is not None and _record(glPushMatrix):
    return
  stack = _s.current
  if len(stack) >= 64:
    raise RuntimeError("OpenGL matrix stack overflow")
  stack.append(list(stack[-1]))


def glPopMatrix():
  if _s.compiling is not None and _record(glPopMatrix):
    return
  stack = _s.current
  if len(stack) > 1:
    stack.pop()
    _matrixChanged()


def glMultMatrixf(m):
  if _s.compiling is not None and _record(glMultMatrixf, m):
    return
  _setTop(_mul(_top(), _flatMatrix(m)))


glMultMatrixd = glMultMatrixf
glLoadMatrixd = glLoadMatrixf


def glTranslatef(x, y, z):
  if _s.compiling is not None and _record(glTranslatef, x, y, z):
    return
  m = _top()
  m[12] += m[0] * x + m[4] * y + m[8] * z
  m[13] += m[1] * x + m[5] * y + m[9] * z
  m[14] += m[2] * x + m[6] * y + m[10] * z
  m[15] += m[3] * x + m[7] * y + m[11] * z
  _matrixChanged()


def glScalef(x, y, z):
  if _s.compiling is not None and _record(glScalef, x, y, z):
    return
  m = _top()
  m[0] *= x; m[1] *= x; m[2] *= x; m[3] *= x
  m[4] *= y; m[5] *= y; m[6] *= y; m[7] *= y
  m[8] *= z; m[9] *= z; m[10] *= z; m[11] *= z
  _matrixChanged()


def glRotatef(angle, x, y, z):
  if _s.compiling is not None and _record(glRotatef, angle, x, y, z):
    return
  length = math.sqrt(x * x + y * y + z * z)
  if length == 0:
    return
  x, y, z = x / length, y / length, z / length
  a = math.radians(angle)
  c, s = math.cos(a), math.sin(a)
  t = 1.0 - c
  r = (t * x * x + c,     t * x * y + s * z, t * x * z - s * y, 0.0,
       t * x * y - s * z, t * y * y + c,     t * y * z + s * x, 0.0,
       t * x * z + s * y, t * y * z - s * x, t * z * z + c,     0.0,
       0.0, 0.0, 0.0, 1.0)
  _setTop(_mul(_top(), r))


glTranslate = glTranslatef
glTranslated = glTranslatef
glScale = glScalef
glScaled = glScalef
glRotate = glRotatef
glRotated = glRotatef


def glOrtho(left, right, bottom, top, near, far):
  if _s.compiling is not None and _record(glOrtho, left, right, bottom, top, near, far):
    return
  rl, tb, fn = right - left, top - bottom, far - near
  o = (2.0 / rl, 0.0, 0.0, 0.0,
       0.0, 2.0 / tb, 0.0, 0.0,
       0.0, 0.0, -2.0 / fn, 0.0,
       -(right + left) / rl, -(top + bottom) / tb, -(far + near) / fn, 1.0)
  _setTop(_mul(_top(), o))


def glFrustum(left, right, bottom, top, near, far):
  if _s.compiling is not None and _record(glFrustum, left, right, bottom, top, near, far):
    return
  rl, tb, fn = right - left, top - bottom, far - near
  f = (2.0 * near / rl, 0.0, 0.0, 0.0,
       0.0, 2.0 * near / tb, 0.0, 0.0,
       (right + left) / rl, (top + bottom) / tb, -(far + near) / fn, -1.0,
       0.0, 0.0, -2.0 * far * near / fn, 0.0)
  _setTop(_mul(_top(), f))


# --- Lighting / materials --------------------------------------------------

def glLightfv(light, pname, params):
  if _s.compiling is not None and _record(glLightfv, light, pname, tuple(params)):
    return
  l = _s.lights[light - GL_LIGHT0]
  p = tuple(float(v) for v in params)
  if pname == GL_POSITION:
    m = _s.stacks[GL_MODELVIEW][-1]
    x, y, z = p[0], p[1], p[2]
    w = p[3] if len(p) > 3 else 1.0
    ex = m[0] * x + m[4] * y + m[8] * z + m[12] * w
    ey = m[1] * x + m[5] * y + m[9] * z + m[13] * w
    ez = m[2] * x + m[6] * y + m[10] * z + m[14] * w
    length = math.sqrt(ex * ex + ey * ey + ez * ez) or 1.0
    l.direction = (ex / length, ey / length, ez / length)
  elif pname == GL_DIFFUSE:
    l.diffuse = (p + (1.0,))[:4]
  elif pname == GL_AMBIENT:
    l.ambient = (p + (1.0,))[:4]
  elif pname == GL_SPECULAR:
    l.specular = (p + (1.0,))[:4]


def glLightf(light, pname, param):
  pass


def glLightModelfv(pname, params):
  if pname == GL_LIGHT_MODEL_AMBIENT:
    _s.sceneAmbient = tuple(float(v) for v in params)[:4]


def glMaterialfv(face, pname, params):
  if _s.compiling is not None and _record(glMaterialfv, face, pname, tuple(params)):
    return
  p = (tuple(float(v) for v in params) + (1.0,))[:4]
  if pname in (GL_AMBIENT, GL_AMBIENT_AND_DIFFUSE):
    _s.matAmbient = p
  if pname in (GL_DIFFUSE, GL_AMBIENT_AND_DIFFUSE):
    _s.matDiffuse = p
  if pname == GL_SPECULAR:
    _s.matSpecular = p


def glMaterialf(face, pname, param):
  if pname == GL_SHININESS:
    _s.shininess = float(param)


# --- Display lists ---------------------------------------------------------

def glGenLists(n):
  first = _s.nextList
  _s.nextList += n
  return first


def glNewList(n, mode):
  _s.compiling = _DisplayList()
  _s.compileMode = mode
  _s.lists[n] = _s.compiling
  _s.compilingId = n
  _s.compileSaved = (_s.color, _s.texcoord, _s.normal)


def glEndList():
  lst = _s.compiling
  _s.compiling = None
  _s.color, _s.texcoord, _s.normal = _s.compileSaved
  if lst.vertices:
    lst.vbo = _s.nextVbo
    _s.nextVbo += 1
    _backend.createStatic(lst.vbo, lst.vertices)
  lst.vertices = None
  if _s.compileMode == GL_COMPILE_AND_EXECUTE:
    glCallList(_s.compilingId)


def glCallList(n):
  if _s.compiling is not None:
    _s.compiling.commands.append((glCallList, (n,)))
    return
  lst = _s.lists.get(n)
  if lst is None:
    return
  for command in lst.commands:
    fn = command[0]
    if fn == "draw":
      _emitDraw(command[1], command[2], command[3], command[4], lst.vbo)
    else:
      fn(*command[1])


def glDeleteLists(n, count):
  for i in range(n, n + count):
    lst = _s.lists.pop(i, None)
    if lst is not None and lst.vbo:
      _s.commands.extend((OP_DELETE_STATIC, lst.vbo))


def glIsList(n):
  return n in _s.lists


# --- Attribute stack -------------------------------------------------------

def glPushAttrib(mask):
  s = _s
  s.attribStack.append((mask, set(s.enabled), s.flags, s.color, s.texcoord, s.normal, s.texture, s.texEnv,
                        s.blendSrc, s.blendDst, s.depthMask, s.matrixMode, s.viewport, s.scissor))


def glPopAttrib():
  s = _s
  if not s.attribStack:
    return
  (mask, enabled, flags, color, texcoord, normal, texture, texEnv,
   blendSrc, blendDst, depthMask, matrixMode, viewport, scissor) = s.attribStack.pop()
  if mask & GL_ENABLE_BIT:
    s.enabled = enabled
    s.flags = flags
  if mask & GL_CURRENT_BIT:
    s.color, s.texcoord, s.normal = color, texcoord, normal
  if mask & GL_TEXTURE_BIT:
    s.texture, s.texEnv = texture, texEnv
  if mask & GL_COLOR_BUFFER_BIT:
    s.blendSrc, s.blendDst = blendSrc, blendDst
    _setEnabled(GL_BLEND, GL_BLEND in enabled)
  if mask & GL_DEPTH_BUFFER_BIT:
    s.depthMask = depthMask
    _setEnabled(GL_DEPTH_TEST, GL_DEPTH_TEST in enabled)
  if mask & GL_TRANSFORM_BIT:
    glMatrixMode(matrixMode)
    _setEnabled(GL_NORMALIZE, GL_NORMALIZE in enabled)
  if mask & GL_VIEWPORT_BIT and viewport != s.viewport:
    glViewport(*viewport)
  if mask & GL_SCISSOR_BIT:
    if scissor != s.scissor:
      glScissor(*scissor)
    _setEnabled(GL_SCISSOR_TEST, GL_SCISSOR_TEST in enabled)


# --- Queries ---------------------------------------------------------------

def glGetIntegerv(pname):
  if pname == GL_VIEWPORT:
    return numpy.array(_s.viewport, dtype = numpy.int32)
  if pname == GL_SCISSOR_BOX:
    return numpy.array(_s.scissor, dtype = numpy.int32)
  if pname == GL_MAX_TEXTURE_SIZE:
    return MAX_TEXTURE_SIZE
  if pname == GL_MATRIX_MODE:
    return _s.matrixMode
  if pname == GL_BLEND_SRC:
    return _s.blendSrc
  if pname == GL_BLEND_DST:
    return _s.blendDst
  if pname == GL_DEPTH_WRITEMASK:
    return int(_s.depthMask)
  raise NotImplementedError("glGetIntegerv(0x%x)" % pname)


def glGetInteger(pname):
  return glGetIntegerv(pname)


def glGetFloatv(pname):
  if pname == GL_CURRENT_COLOR:
    return numpy.array(_s.color, dtype = numpy.float32)
  if pname == GL_MODELVIEW_MATRIX:
    return numpy.array(_s.stacks[GL_MODELVIEW][-1], dtype = numpy.float32).reshape(4, 4)
  if pname == GL_PROJECTION_MATRIX:
    return numpy.array(_s.stacks[GL_PROJECTION][-1], dtype = numpy.float32).reshape(4, 4)
  if pname == GL_TEXTURE_MATRIX:
    return numpy.array(_s.stacks[GL_TEXTURE][-1], dtype = numpy.float32).reshape(4, 4)
  if pname == GL_VIEWPORT:
    return numpy.array(_s.viewport, dtype = numpy.float32)
  raise NotImplementedError("glGetFloatv(0x%x)" % pname)


glGetDoublev = glGetFloatv


def glGetBooleanv(pname):
  if pname == GL_DEPTH_WRITEMASK:
    return _s.depthMask
  return bool(glGetIntegerv(pname))


def glGetString(name):
  return {GL_VENDOR: "WebGL", GL_RENDERER: "Frets on Fire fixed-function emulation",
          GL_VERSION: "1.2 (WebGL2)", GL_EXTENSIONS: ""}.get(name, "")


# --- Textures --------------------------------------------------------------

_WRAP = {GL_CLAMP: GL_CLAMP_TO_EDGE}


def _bytes(data):
  if data is None:
    return None
  if isinstance(data, str):
    return data.encode("latin-1")
  if isinstance(data, numpy.ndarray):
    return numpy.ascontiguousarray(data).tobytes()
  return data


def glGenTextures(n):
  ids = []
  for _ in range(n):
    ids.append(_s.nextTexture)
    _backend.createTexture(_s.nextTexture)
    _s.nextTexture += 1
  return ids[0] if n == 1 else numpy.array(ids, dtype = numpy.uint32)


def glDeleteTextures(ids):
  if isinstance(ids, int):
    ids = [ids]
  for i in ids:
    i = int(i)
    _s.textureSizes.pop(i, None)
    _s.commands.extend((OP_DELETE_TEXTURE, i))
    if _s.texture == i:
      _s.texture = 0


def glIsTexture(texture):
  return texture in _s.textureSizes


def glBindTexture(target, texture):
  if _s.compiling is not None and _record(glBindTexture, target, texture):
    return
  _s.texture = int(texture)


def glTexParameteri(target, pname, param):
  _backend.texParameter(_s.texture, pname, _WRAP.get(param, param))


glTexParameterf = glTexParameteri


def glTexEnvf(target, pname, param):
  if pname == GL_TEXTURE_ENV_MODE:
    _s.texEnv = int(param)


glTexEnvi = glTexEnvf


def glPixelStorei(pname, param):
  _backend.pixelStorei(pname, param)


def glTexImage2D(target, level, internalFormat, width, height, border, format, type, data):
  if type != GL_UNSIGNED_BYTE:
    raise NotImplementedError("Only GL_UNSIGNED_BYTE textures are supported")
  _s.textureSizes[_s.texture] = (width, height)
  _backend.texImage2D(_s.texture, level, internalFormat, width, height, format, _bytes(data))


def glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, data):
  if type != GL_UNSIGNED_BYTE:
    raise NotImplementedError("Only GL_UNSIGNED_BYTE textures are supported")
  _backend.texSubImage2D(_s.texture, level, xoffset, yoffset, width, height, format, _bytes(data))


def glCopyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height):
  pass


def glGenerateMipmapEXT(target):
  _backend.generateMipmap(_s.texture)


glGenerateMipmap = glGenerateMipmapEXT


def _buildMipmaps(target, components, width, height, format, type, data):
  glTexImage2D(target, 0, components, width, height, 0, format, type, data)
  _backend.generateMipmap(_s.texture)


def glDeleteBuffers(n, buffers = None):
  pass


def _noFramebuffers(*args):
  raise NotImplementedError("Framebuffer objects are not supported by the WebGL emulation")


glGenFramebuffersEXT = glBindFramebufferEXT = glGenRenderbuffersEXT = glBindRenderbufferEXT = _noFramebuffers
glRenderbufferStorageEXT = glFramebufferRenderbufferEXT = glFramebufferTexture2DEXT = _noFramebuffers


__all__ = [name for name in list(globals()) if name.startswith("gl") or name.startswith("GL_")]
