"""Game file system helpers: lazily fetched files and IndexedDB persistence."""
import os

from pyodide.ffi import run_sync

import fofjs


def persist(fileName = None):
  """Schedule a write-back of the persistent directory (debounced in JS)."""
  fofjs.persist()


def isLazy(path):
  return fofjs.lazyUrl(os.path.abspath(path)) is not None


def urlFor(path):
  """URL of a lazily fetched game file, or None if the file is fully present in MEMFS."""
  return fofjs.lazyUrl(os.path.abspath(path))


def materialize(path):
  """Make sure a lazily fetched file has its real contents on disk."""
  url = urlFor(path)
  if url is None or os.path.getsize(path) > 0:
    return path
  data = run_sync(fofjs.fetchBytes(url)).to_py()
  with open(path, "wb") as f:
    f.write(data)
  return path


def installHooks():
  import Config
  if persist not in Config.writeHooks:
    Config.writeHooks.append(persist)
