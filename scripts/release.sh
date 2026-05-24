#!/usr/bin/env bash
set -e

REPO="tomfunk/fungible"
TAP_DIR="${HOMEBREW_TAP_DIR:-$HOME/projects/personal/homebrew-fungible}"

# ── Args ──────────────────────────────────────────────────────────────────────

if [[ -z "$1" ]]; then
  echo "Usage: scripts/release.sh <version>"
  echo "  e.g. scripts/release.sh 1.0.2"
  exit 1
fi

VERSION="$1"
TAG="v$VERSION"

# ── Preflight ─────────────────────────────────────────────────────────────────

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty — commit or stash changes first"
  exit 1
fi

if git rev-parse "$TAG" &>/dev/null; then
  echo "error: tag $TAG already exists"
  exit 1
fi

if [[ ! -d "$TAP_DIR" ]]; then
  echo "error: tap directory not found at $TAP_DIR"
  echo "  set HOMEBREW_TAP_DIR to override"
  exit 1
fi

# ── Tag & push ────────────────────────────────────────────────────────────────

echo "→ bumping package.json to $VERSION"
npm pkg set version="$VERSION" --no-workspaces 2>/dev/null || \
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json'));
    pkg.version = '$VERSION';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

git add package.json
git commit -m "Release $TAG"
git push

echo "→ tagging $TAG"
git tag "$TAG"
git push origin "$TAG"

# ── SHA256 ────────────────────────────────────────────────────────────────────

TARBALL_URL="https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz"

echo "→ computing sha256 (downloading tarball)..."
SHA=$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')
echo "  $SHA"

# ── Update formula ────────────────────────────────────────────────────────────

FORMULA="$TAP_DIR/Formula/fungible.rb"

echo "→ updating formula"
sed -i '' "s|/refs/tags/v[^/]*.tar.gz|/refs/tags/$TAG.tar.gz|" "$FORMULA"
sed -i '' "s/sha256 \"[a-f0-9]*\"/sha256 \"$SHA\"/" "$FORMULA"

cd "$TAP_DIR"
git add Formula/fungible.rb
git commit -m "Update to $TAG"
git push

echo ""
echo "✓ released $TAG"
echo "  brew update && brew upgrade fungible"
