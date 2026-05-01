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

# 2. Python venv + tree-sitter for code indexing
echo "🐍 Setting up tree-sitter..."
python3 -m venv .venv
.venv/bin/pip install --quiet tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-sql

# 3. Install as Pi skill
rm -rf "$SKILL_DIR"
mkdir -p "$(dirname "$SKILL_DIR")"
cp -r . "$SKILL_DIR"

# 4. Register with Pi
if command -v pi &>/dev/null; then
    pi install "$SKILL_DIR" 2>/dev/null || true
fi

echo ""
echo "✅ Memory Layer installed."
echo "   Location: $SKILL_DIR"
echo "   Restart Pi to activate."
