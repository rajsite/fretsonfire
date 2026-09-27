"""Frame pacing: every rendered frame ends in flip(), which suspends via JSPI until the next animation frame."""
import time

from pyodide.ffi import run_sync

import fofjs

_flush_hooks = []


def add_flush_hook(hook):
    if hook not in _flush_hooks:
        _flush_hooks.append(hook)


def ticks():
    """Milliseconds since an arbitrary epoch."""
    return time.perf_counter() * 1000.0


def wait(awaitable):
    """Block the Python stack on a JS promise or Python awaitable while the browser keeps running."""
    return run_sync(awaitable)


def flip():
    for hook in _flush_hooks:
        hook()
    return run_sync(fofjs.nextFrame())
