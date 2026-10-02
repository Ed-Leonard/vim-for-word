#!/usr/bin/env bash
# Removes everything install.sh put in your home dir. Add --purge-udev to also remove the system files.
set -euo pipefail
NAME=com.typo.vimword
PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/vimword"

rm -rf "$PREFIX"
rm -f "$HOME/.mozilla/native-messaging-hosts/$NAME.json" \
      "$HOME/.librewolf/native-messaging-hosts/$NAME.json"
for d in google-chrome chromium BraveSoftware/Brave-Browser microsoft-edge; do
  rm -f "$HOME/.config/$d/NativeMessagingHosts/$NAME.json"
done

if [ "${1:-}" = "--purge-udev" ]; then
  sudo rm -f /etc/udev/rules.d/60-vimword-uinput.rules /etc/modules-load.d/vimword.conf
  sudo udevadm control --reload
fi
echo "Uninstalled."
