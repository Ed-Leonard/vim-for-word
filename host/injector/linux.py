"""Linux backend: a virtual keyboard via /dev/uinput. Works on Wayland and X11."""
import time

from evdev import UInput, ecodes as e

ALIASES = {"Ctrl": "LEFTCTRL", "Shift": "LEFTSHIFT", "Alt": "LEFTALT", "Meta": "LEFTMETA"}


class Injector:
    def __init__(self):
        try:
            # Declare capabilities ourselves instead of cloning a physical keyboard.
            self.ui = UInput({e.EV_KEY: list(range(1, 249))}, name="vimword")
        except Exception as ex:
            raise RuntimeError(
                f"cannot create uinput device ({ex}). Is the uinput module loaded and "
                "/dev/uinput writable? Re-run install.sh, or log out and back in."
            ) from ex
        time.sleep(0.3)  # let the compositor notice the new device, or early events are dropped

    def resolve(self, names):
        codes = []
        for n in names:
            code = getattr(e, "KEY_" + ALIASES.get(n, n).upper(), None)
            if not isinstance(code, int):
                raise ValueError(f"unmapped key: {n}")
            codes.append(code)
        return codes

    def _emit(self, code, value):
        self.ui.write(e.EV_KEY, code, value)
        self.ui.syn()

    def tap(self, codes):
        down = []
        try:
            for c in codes:
                self._emit(c, 1)
                down.append(c)
        finally:
            for c in reversed(down):
                self._emit(c, 0)
