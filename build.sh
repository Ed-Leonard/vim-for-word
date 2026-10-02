#!/usr/bin/env bash
# Assemble per-browser extension folders in dist/.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "$REPO/dist"
for t in firefox chrome; do
  mkdir -p "$REPO/dist/$t"
  cp "$REPO"/extension/src/*.js "$REPO/dist/$t/"
  cp "$REPO/extension/manifest.$t.json" "$REPO/dist/$t/manifest.json"
done
echo "built dist/firefox and dist/chrome"
