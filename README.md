# vimword

Swallows keyboard inputs and converts them to word shortcuts in NORMAL or VISUAL mode via creating syntethic key events at the OS level. Word will ignore browser synthed keys.

```
content script -> background script -> native host (python, uinput) -> compositor
```

## Install (Linux, Wayland or X11 (X11 not tested))

Requirements: `python3` with `venv`, `sudo` (once, for the udev rule). If `pip install evdev`
fails, install your distro's `python3-evdev` / `python-evdev` first.

```bash
git clone https://github.com/Ed-Leonard/vim-for-word.git && cd vim-for-word
./install.sh
```

Then load the extension:

- **Firefox**: `about:debugging` -> This Firefox -> Load Temporary Add-on ->
  `dist/firefox/manifest.json`. For a permanent install you need a signed build:
  `npx web-ext sign --source-dir dist/firefox --channel=unlisted` (free AMO API keys), or use
  Developer Edition / ESR with `xpinstall.signatures.required=false`.
- **Chrome / Chromium / Brave / Edge**: `chrome://extensions` -> Developer mode -> Load unpacked
  -> `dist/chrome`, copy the extension ID, then `./install.sh --chrome-id <ID>`.

Uninstall: `./uninstall.sh` (add `--purge-udev` to remove the udev rule too).

## Usage


| Keys | Action |
|---|---|
| `h j k l`, `w b`, `G` | move (counts like `5j`) |
| `x u Ctrl+r` | delete char, undo, redo |
| `i a A I o O s` | enter INSERT |
| `v` | VISUAL (motions extend the selection; `y d x c s`; `Esc`/`v` leaves) |
| `y d c` + motion, or doubled | `yw`, `d3w`, `yy`, `dd`, `cc`, `dG` |


## Porting

- **Chrome** is already supported (same sources, separate manifest, `globalThis.browser ?? chrome`). (not tested)
- **Windows**: implement `injector/windows.py` with `SendInput` (same `resolve`/`tap` interface);
  register the host under `HKCU\Software\Mozilla\NativeMessagingHosts\com.typo.vimword` (and the
  Chrome equivalent) pointing at the manifest JSON, with `path` set to a `.bat`/`.exe`; add an
  `install.ps1`.
- **macOS**: a `CGEvent` backend; `keymap.json` already has a `darwin` section (Alt/Meta shortcuts).
