#!/usr/bin/env bash
set -e
# Downloads tree-sitter .wasm grammar files from npm packages.
# Run: bash scripts/fetch-grammars.sh

GRAMMAR_DIR="$(cd "$(dirname "$0")/.." && pwd)/grammars"
mkdir -p "$GRAMMAR_DIR"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "⬇ Installing grammar npm packages..."
npm install --prefix "$TMPDIR" tree-sitter-javascript tree-sitter-typescript 2>/dev/null

# Copy .wasm files from npm packages
for pkg in tree-sitter-javascript tree-sitter-typescript; do
  for wasm in "$TMPDIR/node_modules/$pkg"/*.wasm; do
    if [ -f "$wasm" ]; then
      base=$(basename "$wasm")
      # Rename to our convention: tree-sitter-javascript.wasm → javascript.wasm
      target=$(echo "$base" | sed 's/tree-sitter-//')
      cp "$wasm" "$GRAMMAR_DIR/$target"
      echo "  ✅ $target ($(du -h "$wasm" | cut -f1))"
    fi
  done
done

# SQL grammar may not ship .wasm in npm — build it if tree-sitter-cli is available
if command -v npx &>/dev/null && npx tree-sitter --version &>/dev/null 2>&1; then
  echo "🏗 Building SQL grammar (.wasm)..."
  npm install --prefix "$TMPDIR" tree-sitter-sql 2>/dev/null
  if [ -d "$TMPDIR/node_modules/tree-sitter-sql" ]; then
    if npx tree-sitter build --wasm "$TMPDIR/node_modules/tree-sitter-sql" 2>/dev/null; then
      mv tree-sitter-sql.wasm "$GRAMMAR_DIR/sql.wasm" 2>/dev/null && echo "  ✅ sql.wasm" || echo "  ⚠ SQL WASM build failed"
    else
      echo "  ⚠ SQL WASM build failed (wasi-sdk may need to download first)"
    fi
  fi
else
  echo "⚠ tree-sitter-cli not available — skipping SQL grammar build"
  echo "  To build SQL .wasm later: npm install -D tree-sitter-cli tree-sitter-sql && npx tree-sitter build --wasm node_modules/tree-sitter-sql"
fi

echo ""
echo "📋 Grammar files in $GRAMMAR_DIR:"
ls -lh "$GRAMMAR_DIR"/*.wasm 2>/dev/null || echo "  (none found)"
