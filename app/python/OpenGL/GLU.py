"""GLU functions used by Frets on Fire, implemented on the fixed-function emulation."""
import math

from OpenGL import GL


def gluPerspective(fovy, aspect, near, far):
  f = 1.0 / math.tan(math.radians(fovy) / 2.0)
  m = (f / aspect, 0.0, 0.0, 0.0,
       0.0, f, 0.0, 0.0,
       0.0, 0.0, (far + near) / (near - far), -1.0,
       0.0, 0.0, 2.0 * far * near / (near - far), 0.0)
  GL.glMultMatrixf(m)


def gluOrtho2D(left, right, bottom, top):
  GL.glOrtho(left, right, bottom, top, -1.0, 1.0)


def gluLookAt(eyeX, eyeY, eyeZ, centerX, centerY, centerZ, upX, upY, upZ):
  fx, fy, fz = centerX - eyeX, centerY - eyeY, centerZ - eyeZ
  length = math.sqrt(fx * fx + fy * fy + fz * fz) or 1.0
  fx, fy, fz = fx / length, fy / length, fz / length
  # s = f x up
  sx, sy, sz = fy * upZ - fz * upY, fz * upX - fx * upZ, fx * upY - fy * upX
  length = math.sqrt(sx * sx + sy * sy + sz * sz) or 1.0
  sx, sy, sz = sx / length, sy / length, sz / length
  # u = s x f
  ux, uy, uz = sy * fz - sz * fy, sz * fx - sx * fz, sx * fy - sy * fx
  m = (sx, ux, -fx, 0.0,
       sy, uy, -fy, 0.0,
       sz, uz, -fz, 0.0,
       0.0, 0.0, 0.0, 1.0)
  GL.glMultMatrixf(m)
  GL.glTranslatef(-eyeX, -eyeY, -eyeZ)


def gluBuild2DMipmaps(target, components, width, height, format, type, data):
  GL._buildMipmaps(target, components, width, height, format, type, data)
  return 0


def gluErrorString(error):
  return "no error" if error == GL.GL_NO_ERROR else "OpenGL error 0x%x" % error


__all__ = ["gluPerspective", "gluOrtho2D", "gluLookAt", "gluBuild2DMipmaps", "gluErrorString"]
