#!/usr/bin/env bash
set -e

SKILL_DIR="${HOME}/.pi/agent/skills/memory-layer"
REPO_URL="https://github.com/genegulanesjr/PiMemoryExtension"

echo "📦 Installing Pi Memory Layer..."

# 1. Clone to temp
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
git clone --depth 1 "$REPO_URL" "$TMPDIR"
cd "$TMPDIR"

# 2. Install web-tree-sitter (WASM runtime)
echo "🕸 Setting up web-tree-sitter..."
npm install --production

# 3. Grammar .wasm files are bundled in grammars/ — no download needed
if [ ! -f "grammars/javascript.wasm" ]; then
  echo "📥 Grammar WASM files missing, fetching..."
  bash scripts/fetch-grammars.sh
fi

# 4. Install as Pi skill
rm -rf "$SKILL_DIR"
mkdir -p "$(dirname "$SKILL_DIR")"
cp -r . "$SKILL_DIR"

# 5. Register with Pi
if command -v pi &>/dev/null; then
    pi install "$SKILL_DIR" 2>/dev/null || true
fi

echo ""
echo "✅ Memory Layer installed."
echo "   Location: $SKILL_DIR"
echo "   Parser: web-tree-sitter (WASM, zero Python dependency)"
echo "   Restart Pi to activate."