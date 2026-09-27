"""Browser input: converts events queued by src/input.ts into pygame-shaped event objects."""
import pygame

import fofinput

# KeyboardEvent.code -> pygame key constant name
_CODE_NAMES = {
  "Escape": "K_ESCAPE", "Enter": "K_RETURN", "NumpadEnter": "K_KP_ENTER", "Tab": "K_TAB", "Backspace": "K_BACKSPACE",
  "Space": "K_SPACE", "Delete": "K_DELETE", "Insert": "K_INSERT", "Home": "K_HOME", "End": "K_END",
  "PageUp": "K_PAGEUP", "PageDown": "K_PAGEDOWN", "ArrowLeft": "K_LEFT", "ArrowRight": "K_RIGHT",
  "ArrowUp": "K_UP", "ArrowDown": "K_DOWN", "ShiftLeft": "K_LSHIFT", "ShiftRight": "K_RSHIFT",
  "ControlLeft": "K_LCTRL", "ControlRight": "K_RCTRL", "AltLeft": "K_LALT", "AltRight": "K_RALT",
  "MetaLeft": "K_LMETA", "MetaRight": "K_RMETA", "CapsLock": "K_CAPSLOCK", "NumLock": "K_NUMLOCK",
  "ScrollLock": "K_SCROLLOCK", "Pause": "K_PAUSE", "PrintScreen": "K_PRINT", "ContextMenu": "K_MENU",
  "Minus": "K_MINUS", "Equal": "K_EQUALS", "BracketLeft": "K_LEFTBRACKET", "BracketRight": "K_RIGHTBRACKET",
  "Backslash": "K_BACKSLASH", "Semicolon": "K_SEMICOLON", "Quote": "K_QUOTE", "Backquote": "K_BACKQUOTE",
  "Comma": "K_COMMA", "Period": "K_PERIOD", "Slash": "K_SLASH",
  "NumpadDivide": "K_KP_DIVIDE", "NumpadMultiply": "K_KP_MULTIPLY", "NumpadSubtract": "K_KP_MINUS",
  "NumpadAdd": "K_KP_PLUS", "NumpadDecimal": "K_KP_PERIOD",
}
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
  _CODE_NAMES["Key" + _c] = "K_" + _c.lower()
for _d in range(10):
  _CODE_NAMES["Digit%d" % _d] = "K_%d" % _d
  _CODE_NAMES["Numpad%d" % _d] = "K_KP%d" % _d
for _f in range(1, 16):
  _CODE_NAMES["F%d" % _f] = "K_F%d" % _f

KEYMAP = {code: getattr(pygame, name) for code, name in _CODE_NAMES.items() if hasattr(pygame, name)}

_SPECIAL_UNICODE = {pygame.K_RETURN: "\r", pygame.K_KP_ENTER: "\r", pygame.K_TAB: "\t",
                    pygame.K_BACKSPACE: "\x08", pygame.K_ESCAPE: "\x1b", pygame.K_DELETE: "\x7f"}


class Event(object):
  def __init__(self, type, **attrs):
    self.type = type
    self.__dict__.update(attrs)

  def __repr__(self):
    return "<Event %s %s>" % (pygame.event.event_name(self.type), self.__dict__)


_injected = []


def post(event):
  """Queue an event generated on the Python side (e.g. music end)."""
  _injected.append(event)


def setRepeat(enabled):
  fofinput.keyRepeat = bool(enabled)


def setCursorVisible(visible):
  fofinput.setCursorVisible(bool(visible))


def joysticks():
  return [(j["index"], j["buttons"], j["axes"], j["hats"]) for j in fofinput.joystickInfo().to_py()]


def keyName(key):
  for code, k in KEYMAP.items():
    if k == key:
      name = _CODE_NAMES[code][2:]
      return name.lower() if len(name) > 1 else name
  return "unknown key"


def getEvents():
  events, _injected[:] = list(_injected), []
  for e in fofinput.drain().to_py():
    t = e["t"]
    if t == "keydown" or t == "keyup":
      key = KEYMAP.get(e["code"])
      if key is None:
        continue
      if t == "keydown":
        events.append(Event(pygame.KEYDOWN, key = key, unicode = e["key"] or _SPECIAL_UNICODE.get(key, ""), mod = 0, scancode = 0))
      else:
        events.append(Event(pygame.KEYUP, key = key, mod = 0, scancode = 0))
    elif t == "mousemove":
      events.append(Event(pygame.MOUSEMOTION, pos = (e["x"], e["y"]), rel = (e["dx"], e["dy"]), buttons = (0, 0, 0)))
    elif t == "mousedown":
      events.append(Event(pygame.MOUSEBUTTONDOWN, button = e["button"], pos = (e["x"], e["y"])))
    elif t == "mouseup":
      events.append(Event(pygame.MOUSEBUTTONUP, button = e["button"], pos = (e["x"], e["y"])))
    elif t == "joybutton":
      events.append(Event(pygame.JOYBUTTONDOWN if e["down"] else pygame.JOYBUTTONUP, joy = e["joy"], button = e["button"]))
    elif t == "joyaxis":
      events.append(Event(pygame.JOYAXISMOTION, joy = e["joy"], axis = e["axis"], value = e["value"]))
    elif t == "joyhat":
      events.append(Event(pygame.JOYHATMOTION, joy = e["joy"], hat = e["hat"], value = (e["x"], e["y"])))
    elif t == "resize":
      events.append(Event(pygame.VIDEORESIZE, size = (e["width"], e["height"]), w = e["width"], h = e["height"]))
  return events
