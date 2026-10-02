#!/usr/bin/env python3
"""
Native messaging host. The browser starts this process and talks to it over stdio.

  in : {"id": 1, "keys": ["Shift+WordRight", "Copy"], "count": 1, "shift": false}
  out: {"id": 1, "ok": true}   or   {"id": 1, "ok": false, "error": "..."}

It never reads or grabs the physical keyboard. NEVER print to stdout (it is the protocol
channel); use stderr for logging. `--check` creates the virtual device and exits.
"""
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

with open(os.path.join(HERE, "keymap.json")) as f:
    _km = json.load(f)
KEYMAP = {**_km["default"], **_km.get(sys.platform, {})}

MAX_COUNT = 100
BATCH_SIZE = 4
BATCH_GAP = 0.03


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (length,) = struct.unpack("=I", raw)
    return json.loads(sys.stdin.buffer.read(length))


def send_message(msg):
    data = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def key_names(spec, shift=False):
    """'Shift+WordRight' -> ['Shift', 'Ctrl', 'Right'] (modifiers first, no duplicates)."""
    out = ["Shift"] if shift else []
    for part in spec.split("+"):
        for n in KEYMAP.get(part, [part]):
            if n not in out:
                out.append(n)
    return out


def handle(inj, msg):
    keys = msg.get("keys")
    if not isinstance(keys, list) or not keys:
        raise ValueError("keys must be a non-empty list")
    count = min(max(int(msg.get("count", 1)), 1), MAX_COUNT)
    shift = bool(msg.get("shift"))
    # Resolve everything first so a bad key name never leaves a half-executed sequence.
    steps = [inj.resolve(key_names(k, shift)) for k in keys]
    for i in range(count):
        for codes in steps:
            inj.tap(codes)
        if (i + 1) % BATCH_SIZE == 0 and i + 1 < count:
            time.sleep(BATCH_GAP)


def main():
    inj, init_error = None, None
    try:
        from injector import Injector
        inj = Injector()
    except Exception as ex:
        init_error = str(ex)
        print(f"vimword: {init_error}", file=sys.stderr)

    if "--check" in sys.argv:
        if init_error:
            sys.exit(1)
        print("ok")
        return

    while True:
        msg = read_message()
        if msg is None:
            return
        try:
            if init_error:
                raise RuntimeError(init_error)
            handle(inj, msg)
            resp = {"ok": True}
        except Exception as ex:
            resp = {"ok": False, "error": str(ex)}
        resp["id"] = msg.get("id")  # always echo, so the extension's promise resolves
        send_message(resp)


if __name__ == "__main__":
    main()
