#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.cache"
ARCHIVE="${1:-$CACHE/openarena-0.8.8.zip}"
URL="https://downloads.sourceforge.net/project/oarena/openarena-0.8.8.zip"
SHA1="37ab41990b37459822ce8c2fe590607616e1f6d1"
mkdir -p "$CACHE/openarena-0.8.8" "$ROOT/public/baseoa" "$ROOT/public/engine"
[[ -f "$ARCHIVE" ]] || curl -fL --retry 3 "$URL" -o "$ARCHIVE"
echo "$SHA1  $ARCHIVE" | sha1sum --check -
unzip -oq "$ARCHIVE" -d "$CACHE/openarena-0.8.8"
BASEOA="$(find "$CACHE/openarena-0.8.8" -type d -name baseoa -print -quit)"
[[ -n "$BASEOA" ]] || { echo 'baseoa not found' >&2; exit 1; }
cp "$BASEOA"/*.pk3 "$ROOT/public/baseoa/"
node "$ROOT/scripts/write-manifest.mjs"
