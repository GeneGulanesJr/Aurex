# Language Support Matrix

CrossHash detects 21 language/file families in Phase 7:

| Language | Extensions | Extraction status |
|---|---|---|
| Rust | `.rs` | Tree-sitter entities + edges |
| TypeScript | `.ts`, `.tsx` | Tree-sitter entities + edges |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | Tree-sitter entities + edges |
| Python | `.py`, `.pyw` | Tree-sitter entities + edges |
| Go | `.go` | Detection |
| Java | `.java` | Detection |
| C | `.c`, `.h` | Detection |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp` | Detection |
| C# | `.cs` | Detection |
| Ruby | `.rb` | Detection |
| PHP | `.php` | Detection |
| Swift | `.swift` | Detection |
| Kotlin | `.kt`, `.kts` | Detection |
| Scala | `.scala` | Detection |
| Elixir | `.ex`, `.exs` | Detection |
| Dart | `.dart` | Detection |
| OCaml | `.ml`, `.mli` | Detection |
| Zig | `.zig` | Detection |
| Bash | `.sh`, `.bash`, `.zsh` | Detection |
| HTML | `.html`, `.htm` | Detection |
| CSS | `.css` | Detection |

Languages marked “Detection” are recognized by the indexer so workspaces report them and can be routed to future Tree-sitter extractors.
