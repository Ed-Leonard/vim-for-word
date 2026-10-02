#!/usr/bin/env bash
# vimword installer (Linux). Safe to re-run.
set -euo pipefail

NAME=com.typo.vimword
FF_ID="vimword@typo"   # must match gecko.id in extension/manifest.firefox.json
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/vimword"
CHROME_ID=""
SKIP_UDEV=0

usage() {
  cat <<EOF
Usage: ./install.sh [--chrome-id ID] [--no-udev]
  --chrome-id ID  also register the host for Chrome/Chromium/Brave/Edge
                  (load dist/chrome unpacked first and copy the ID from chrome://extensions)
  --no-udev       skip the sudo step (you must grant access to /dev/uinput yourself)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --chrome-id) CHROME_ID="${2:?--chrome-id needs a value}"; shift 2 ;;
    --no-udev)   SKIP_UDEV=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[ "$(uname -s)" = Linux ] || { echo "install.sh is Linux-only (see README for other platforms)"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

# 1. The only step that needs root: let the desktop user open /dev/uinput.
RULE_SRC="$REPO/packaging/60-vimword-uinput.rules"
RULE_DST=/etc/udev/rules.d/60-vimword-uinput.rules
if [ "$SKIP_UDEV" -eq 0 ] && ! cmp -s "$RULE_SRC" "$RULE_DST"; then
  echo "==> Installing udev rule (sudo)"
  sudo install -m644 "$RULE_SRC" "$RULE_DST"
  echo uinput | sudo tee /etc/modules-load.d/vimword.conf >/dev/null
  sudo modprobe uinput
  sudo udevadm control --reload
  sudo udevadm trigger --subsystem-match=misc
  sleep 1
fi
if [ ! -w /dev/uinput ]; then
  echo "WARNING: /dev/uinput is not writable by you yet. Log out and back in, then re-run."
fi

# 2. Host files + python environment (user-level, no system pip).
echo "==> Installing host to $PREFIX"
mkdir -p "$PREFIX"
rm -rf "$PREFIX/injector"
cp -r "$REPO/host/." "$PREFIX/"
if [ ! -x "$PREFIX/venv/bin/python" ]; then
  python3 -m venv --system-site-packages "$PREFIX/venv" \
    || { echo "python3 -m venv failed (install python3-venv)"; exit 1; }
fi
if ! "$PREFIX/venv/bin/python" -c 'import evdev' 2>/dev/null; then
  "$PREFIX/venv/bin/pip" install -q evdev \
    || { echo "Could not pip install evdev. Install your distro package (python3-evdev / python-evdev) and re-run."; exit 1; }
fi

# 3. Wrapper: manifest "path" cannot take arguments or pick a venv.
cat > "$PREFIX/vimword-host" <<EOF
#!/bin/sh
exec "$PREFIX/venv/bin/python" "$PREFIX/vimword_host.py" "\$@"
EOF
chmod +x "$PREFIX/vimword-host"

# 4. Native messaging manifests.
manifest() {  # dir, allow-key, allow-value
  mkdir -p "$1"
  cat > "$1/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "vimword key injector",
  "path": "$PREFIX/vimword-host",
  "type": "stdio",
  "$2": ["$3"]
}
EOF
  echo "    registered $1/$NAME.json"
}
echo "==> Registering native messaging host"
manifest "$HOME/.mozilla/native-messaging-hosts" allowed_extensions "$FF_ID"
[ -d "$HOME/.librewolf" ] && manifest "$HOME/.librewolf/native-messaging-hosts" allowed_extensions "$FF_ID"
if [ -n "$CHROME_ID" ]; then
  for d in google-chrome chromium BraveSoftware/Brave-Browser microsoft-edge; do
    [ -d "$HOME/.config/$d" ] && \
      manifest "$HOME/.config/$d/NativeMessagingHosts" allowed_origins "chrome-extension://$CHROME_ID/"
  done
fi

# 5. Build the extension and self-test the host.
"$REPO/build.sh"
echo "==> Self-test"
"$PREFIX/vimword-host" --check || echo "WARNING: self-test failed (see message above)"

cat <<EOF

Done. Next:
  Firefox: about:debugging -> This Firefox -> Load Temporary Add-on -> $REPO/dist/firefox/manifest.json
           (permanent install needs a signed build, see README)
  Chrome:  chrome://extensions -> Developer mode -> Load unpacked -> $REPO/dist/chrome
           then: ./install.sh --chrome-id <the ID shown there>
EOF
