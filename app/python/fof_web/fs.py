"""Game file system helpers: lazily fetched files and IndexedDB persistence."""
import os

from pyodide.ffi import run_sync

import fofjs


def persist(fileName = None):
  """Schedule a write-back of the persistent directory (debounced in JS)."""
  fofjs.persist()


def isLazy(path):
  return fofjs.lazyOrigin(os.path.abspath(path)) is not None


def urlFor(path):
  """Origin (URL or zip entry) of a lazily read game file, or None if the file is fully present in MEMFS."""
  return fofjs.lazyOrigin(os.path.abspath(path))


def materialize(path):
  """Make sure a lazily read file has its real contents on disk."""
  path = os.path.abspath(path)
  if fofjs.lazyOrigin(path) is None or not os.path.isfile(path) or os.path.getsize(path) > 0:
    return path
  data = run_sync(fofjs.readLazy(path)).to_py()
  with open(path, "wb") as f:
    f.write(data)
  return path


def _materializeResource(path):
  # Audio is decoded by the browser straight from its source and never copied into MEMFS.
  if not path.lower().endswith(".ogg"):
    materialize(path)


def installHooks():
  import Config
  import Resource
  if persist not in Config.writeHooks:
    Config.writeHooks.append(persist)
  Resource.fileNameHook = _materializeResource
