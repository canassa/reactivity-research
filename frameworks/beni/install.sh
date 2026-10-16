#!/usr/bin/env bash
# Build the pinned beni compiler into frameworks/beni/compiler/<commit>/ (gitignored). Needs the
# network once (the beni sources, unless BENI_REPO is a local clone holding the commit, and
# beni's Nix toolchain); every later build of an app runs offline. See README.md.
#
#   frameworks/beni/install.sh                       # sources from GitHub
#   BENI_REPO=~/src/beni frameworks/beni/install.sh  # or from a local clone (not modified)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMIT="$(sed -n 's/^export const COMMIT = "\([0-9a-f]\{40\}\)";$/\1/p' "$HERE/beni.js")"
[ -n "$COMMIT" ] || { echo "no COMMIT in beni.js" >&2; exit 1; }
REPO="${BENI_REPO:-https://github.com/canassa/beni}"
DIR="$HERE/compiler/${COMMIT:0:12}"

if [ -x "$DIR/zig-out/bin/beni" ]; then
  echo "beni ${COMMIT:0:12} is already built: $DIR/zig-out/bin/beni"
  exit 0
fi

# A clone of exactly that commit: its own git repository, so `nix develop` reads its flake.
rm -rf "$DIR"
mkdir -p "$DIR"
git -C "$DIR" init -q
git -C "$DIR" fetch -q --depth 1 "$REPO" "$COMMIT"
git -C "$DIR" checkout -q --detach FETCH_HEAD

# beni's own toolchain (Zig and Node, pinned by its flake.nix) and its documented release build.
cd "$DIR"
nix develop "$DIR" -c zig build -Doptimize=ReleaseFast
"$DIR/zig-out/bin/beni" version
