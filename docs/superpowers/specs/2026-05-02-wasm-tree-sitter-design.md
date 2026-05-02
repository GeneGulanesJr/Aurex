# Replace Python tree-sitter with web-tree-sitter (WASM)

## Goal

Eliminate the Python + venv + pip dependency chain by rewriting the AST parser (`parse_code.py`) as an in-process Node.js module using `web-tree-sitter` (WASM). Grammar `.wasm` files are bundled inside the skill directory at `grammars/`.

## Architecture

`parse-code.js` replaces `parse_code.py` as a native Node.js module. The web-tree-sitter WASM runtime and pre-compiled grammar `.wasm` files are loaded in-process — no subprocess spawns. The parser lazy-initializes on first use: `Parser.init()` (loads `tree-sitter.wasm` runtime) then `Language.load()` for each grammar. After init, `parser.parse(source)` is synchronous, so `parseFile()` remains sync. Only the `index-repo` and `reindex-repo` code paths become async (to await init). All other subcommands stay synchronous.

## Files

| File | Action | Responsibility |
|---|---|---|
| `parse-code.js` | Create | WASM-based parser: init, parseFile, JS/TS/SQL AST walkers |
| `grammars/javascript.wasm` | Create (binary) | Pre-compiled JS grammar |
| `grammars/typescript.wasm` | Create (binary) | Pre-compiled TS grammar |
| `grammars/tree-sitter-tsx.wasm` | Create (binary) | Pre-compiled TSX grammar |
| `grammars/sql.wasm` | Create (binary) | Pre-compiled SQL grammar |
| `scripts/fetch-grammars.sh` | Create | Dev script to download/update .wasm files from GitHub releases |
| `memory-store.js` | Modify | Replace Python subprocess with in-process WASM; make indexing async |
| `install.sh` | Modify | Remove Python/pip steps; add npm install for web-tree-sitter |
| `SKILL.md` | Modify | Update to note zero Python dependency |
| `parse_code.py` | Delete | No longer needed |

## Output Schema (unchanged)

`parseFile()` returns the same array shape as the Python version:

```json
{
  "name": "myFunction",
  "kind": "function",
  "language": "javascript",
  "file": "/path/to/file.js",
  "signature": "function myFunction(a, b) {",
  "qualified_name": "MyClass.myFunction",
  "start_line": 10,
  "end_line": 25,
  "start_byte": 120,
  "end_byte": 340,
  "docstring": "Does a thing",
  "body_preview": "const x = a + b...",
  "parent_name": "MyClass"
}
```

## Error Handling

- If `web-tree-sitter` is not installed → `init()` logs warning, `isReady()` returns false, `parseFile()` returns `[]`
- If `.wasm` grammar file is missing → that language is skipped (graceful, same pattern as Python ImportError)
- Parse errors → return `[]` for that file, don't crash indexing

## Performance

| Metric | Before (Python subprocess) | After (WASM in-process) |
|---|---|---|
| Per-file parse overhead | ~500ms (process spawn) | ~5ms (in-process) |
| 100-file repo index | ~50s | ~1-2s |
| Memory | New Python process per file | Shared WASM instance (~3MB) |

## Dependencies

### New
- `web-tree-sitter` npm package (WASM runtime + tree-sitter.wasm core)

### Removed
- Python 3 + venv
- `tree-sitter` pip package
- `tree-sitter-javascript` pip package
- `tree-sitter-typescript` pip package
- `tree-sitter-sql` pip package