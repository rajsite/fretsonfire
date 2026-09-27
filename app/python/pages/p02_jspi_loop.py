"""Page 02: blocking loops (outer, nested dialog-style, and nested awaits) driven by JSPI."""
import json

import fofjs
from js import fetch
from fof_web import frame


def run():
    state = {"frames": 0, "nestedFrames": 0, "fetchedBytes": 0, "clicks": 0}
    intervals = []
    last = [frame.ticks()]

    def tick():
        frame.flip()
        now = frame.ticks()
        intervals.append(now - last[0])
        last[0] = now
        state["frames"] += 1
        fofjs.setCounter(state["frames"])

    def run_dialog(n):
        # Mirrors Dialogs._runDialog: a sub event loop inside the main loop.
        for _ in range(n):
            tick()
            state["nestedFrames"] += 1
        response = frame.wait(fetch("/game/manifest.json"))
        state["fetchedBytes"] = len(frame.wait(response.text()))

    while state["frames"] < 120:
        tick()
        if state["frames"] == 30:
            run_dialog(30)

    state["clicks"] = fofjs.clickCount()
    steady = intervals[10:]
    state["avgFrameMs"] = sum(steady) / len(steady)
    state["maxFrameMs"] = max(steady)
    return json.dumps(state)
