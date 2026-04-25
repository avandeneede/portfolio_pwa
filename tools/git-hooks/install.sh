#!/usr/bin/env bash
# Install repo-managed git hooks.
#
# We don't use husky or any npm-based hook manager — this repo is
# bundler-free and doesn't have a package.json on purpose. Just symlink
# the tracked hooks into .git/hooks/.
#
# Usage:
#   tools/git-hooks/install.sh

set -e

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

HOOKS_SRC="tools/git-hooks"
HOOKS_DST=".git/hooks"

mkdir -p "$HOOKS_DST"

for hook in "$HOOKS_SRC"/*; do
  name="$(basename "$hook")"
  # Skip the installer itself and any non-executable helpers.
  if [ "$name" = "install.sh" ] || [ "$name" = "README.md" ]; then continue; fi
  ln -sf "../../$hook" "$HOOKS_DST/$name"
  chmod +x "$hook"
  echo "installed: $HOOKS_DST/$name -> ../../$hook"
done
