"""
Browser replacement for the parts of PyOpenGL used by Frets on Fire.

Only OpenGL.GL, OpenGL.GLU and OpenGL.GL.ARB.multisample are provided. The
fixed-function pipeline is emulated in OpenGL.GL and rendered with WebGL2 by the
JavaScript backend registered as the ``fofgl`` module.
"""
