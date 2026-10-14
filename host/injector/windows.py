"""Windows backend: SendInput via ctypes (no third-party dependencies)."""
import ctypes
from ctypes import wintypes

ALIASES = {"Ctrl": "LEFTCTRL", "Shift": "LEFTSHIFT", "Alt": "LEFTALT", "Meta": "LEFTMETA"}

# Virtual-key codes, keyed by the evdev names with the "KEY_" prefix removed.
_VK = {
    "LEFTCTRL": 0xA2, "RIGHTCTRL": 0xA3, "LEFTSHIFT": 0xA0, "RIGHTSHIFT": 0xA1,
    "LEFTALT": 0xA4, "RIGHTALT": 0xA5, "LEFTMETA": 0x5B, "RIGHTMETA": 0x5C,
    "ESC": 0x1B, "TAB": 0x09, "ENTER": 0x0D, "BACKSPACE": 0x08, "SPACE": 0x20,
    "CAPSLOCK": 0x14,
    "PAGEUP": 0x21, "PAGEDOWN": 0x22, "END": 0x23, "HOME": 0x24,
    "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
    "INSERT": 0x2D, "DELETE": 0x2E,
    "MINUS": 0xBD, "EQUAL": 0xBB, "COMMA": 0xBC, "DOT": 0xBE, "SLASH": 0xBF,
    "SEMICOLON": 0xBA, "APOSTROPHE": 0xDE, "GRAVE": 0xC0,
    "LEFTBRACE": 0xDB, "RIGHTBRACE": 0xDD, "BACKSLASH": 0xDC,
}
_VK.update({chr(c): c for c in range(ord("A"), ord("Z") + 1)})
_VK.update({str(d): 0x30 + d for d in range(10)})
_VK.update({f"F{i}": 0x6F + i for i in range(1, 25)})

# Keys that need KEYEVENTF_EXTENDEDKEY. Without it the cursor-block keys can be read as
# NUMPAD keys when NumLock is on (Left would act as Numpad4, not as an arrow).
_EXTENDED = {
    0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E,  # PgUp..Delete
    0xA3, 0xA5, 0x5B, 0x5C,  # right Ctrl / right Alt / Windows keys
}

KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
INPUT_KEYBOARD = 1
MAPVK_VK_TO_VSC = 0

ULONG_PTR = wintypes.WPARAM  # pointer-sized unsigned integer


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


# The union MUST include MOUSEINPUT (the largest member), or sizeof(INPUT) is wrong and
# SendInput fails with ERROR_INVALID_PARAMETER.
class _InputUnion(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _InputUnion)]


class Injector:
    def __init__(self):
        try:
            self.user32 = ctypes.WinDLL("user32", use_last_error=True)
            self.user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
            self.user32.SendInput.restype = wintypes.UINT
            self.user32.MapVirtualKeyW.argtypes = (wintypes.UINT, wintypes.UINT)
            self.user32.MapVirtualKeyW.restype = wintypes.UINT
        except Exception as ex:
            raise RuntimeError(f"cannot load user32 ({ex}). Is this Windows?") from ex
        expected = 40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28
        if ctypes.sizeof(INPUT) != expected:
            raise RuntimeError(f"INPUT struct is {ctypes.sizeof(INPUT)} bytes, expected {expected}")

    def resolve(self, names):
        codes = []
        for n in names:
            vk = _VK.get(ALIASES.get(n, n).upper())
            if vk is None:
                raise ValueError(f"unmapped key: {n}")
            codes.append(vk)
        return codes

    def _input(self, vk, up):
        flags = KEYEVENTF_KEYUP if up else 0
        if vk in _EXTENDED:
            flags |= KEYEVENTF_EXTENDEDKEY
        scan = self.user32.MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)
        inp = INPUT(type=INPUT_KEYBOARD)
        inp.ki = KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)
        return inp

    def _send(self, events):
        n = len(events)
        arr = (INPUT * n)(*events)
        sent = self.user32.SendInput(n, arr, ctypes.sizeof(INPUT))
        if sent != n:
            # 0 with ERROR_ACCESS_DENIED usually means the focused window is elevated (UIPI).
            raise ctypes.WinError(ctypes.get_last_error())

    def tap(self, codes):
        downs = [self._input(c, False) for c in codes]
        ups = [self._input(c, True) for c in reversed(codes)]
        try:
            # One call, so nothing else (e.g. the user's own typing) can interleave.
            self._send(downs + ups)
        except OSError:
            try:
                self._send(ups)  # never leave a modifier stuck down
            except OSError:
                pass
            raise