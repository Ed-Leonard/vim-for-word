"""
Platform backends. Every backend exposes the same interface:

    class Injector:
        def __init__(self): ...            # create/open the virtual input device
        def resolve(self, names): ...      # ["Ctrl", "Right"] -> backend key codes
                                           #   (raise ValueError for unknown names)
        def tap(self, codes): ...          # press in order, release in reverse, synchronously

To add a platform, drop a module next to linux.py and add a branch below.
  windows: SendInput via ctypes     macos: CGEventCreateKeyboardEvent via pyobjc/ctypes
Per-platform shortcut differences live in keymap.json, not in code.
"""
import sys

if sys.platform.startswith("linux"):
    from .linux import Injector
else:
    raise NotImplementedError(
        f"no key injector backend for platform {sys.platform!r}; see injector/__init__.py"
    )

__all__ = ["Injector"]
