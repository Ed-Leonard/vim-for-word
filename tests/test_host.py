import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


host = load("vimword_host", "host/vimword_host.py")


class HostTests(unittest.TestCase):
    def test_counted_motion_has_no_sleep_and_still_caps_count(self):
        for count, expected in [(1, 1), (4, 4), (5, 5), (100, 100), (101, 100)]:
            with self.subTest(count=count), patch("time.sleep") as sleep:
                inj = Mock()
                inj.resolve.return_value = [1]
                host.handle(inj, {"keys": ["Down"], "count": count})
                self.assertEqual(inj.tap.call_count, expected)
                sleep.assert_not_called()

    def test_invalid_sequence_is_not_partially_injected(self):
        inj = Mock()
        inj.resolve.side_effect = [[1], ValueError("unmapped key")]
        with self.assertRaises(ValueError):
            host.handle(inj, {"keys": ["Down", "Invalid"]})
        inj.tap.assert_not_called()

    def test_shortcut_uses_two_frames_with_reverse_release(self):
        events = []
        ui = SimpleNamespace(
            write=lambda *event: events.append(event),
            syn=lambda: events.append("syn"),
        )
        evdev = SimpleNamespace(UInput=Mock(), ecodes=SimpleNamespace(EV_KEY=1))
        with patch.dict(sys.modules, evdev=evdev):
            linux = load("linux_injector", "host/injector/linux.py")
        inj = linux.Injector.__new__(linux.Injector)
        inj.ui = ui
        inj.tap([42, 29, 106])
        self.assertEqual(events, [
            (1, 42, 1), (1, 29, 1), (1, 106, 1), "syn",
            (1, 106, 0), (1, 29, 0), (1, 42, 0), "syn",
        ])

    def test_injection_failure_releases_pressed_keys(self):
        evdev = SimpleNamespace(UInput=Mock(), ecodes=SimpleNamespace(EV_KEY=1))
        with patch.dict(sys.modules, evdev=evdev):
            linux = load("linux_injector", "host/injector/linux.py")
        inj = linux.Injector.__new__(linux.Injector)
        inj.ui = Mock()
        inj.ui.write.side_effect = [None, OSError("write failed"), None]
        with self.assertRaises(OSError):
            inj.tap([42, 106])
        self.assertEqual(inj.ui.write.call_args.args, (1, 42, 0))
        inj.ui.syn.assert_called_once()
