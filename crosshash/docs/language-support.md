# Language Support Matrix

CrossHash detects 21 language/file families and extracts entities + edges for 19 of them:

| Language | Extensions | Entity extraction | Import resolution |
|---|---|---|---|
| Rust | `.rs` | Tree-sitter entities + edges | `use` imports |
| TypeScript | `.ts`, `.tsx` | Tree-sitter entities + edges | `import`/`export` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | Tree-sitter entities + edges | `import`/`export` |
| Python | `.py`, `.pyw` | Tree-sitter entities + edges | `import`/`from...import` |
| Go | `.go` | Tree-sitter entities + edges | `import` blocks |
| Java | `.java` | Tree-sitter entities + edges | `import` statements |
| C | `.c`, `.h` | Tree-sitter entities | Detection only |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp` | Tree-sitter entities | Detection only |
| C# | `.cs` | Tree-sitter entities | Detection only |
| Ruby | `.rb` | Tree-sitter entities + edges | `require`/`require_relative` |
| PHP | `.php` | Tree-sitter entities | Detection only |
| Swift | `.swift` | Tree-sitter entities | Detection only |
| Kotlin | `.kt`, `.kts` | Tree-sitter entities | Detection only |
| Scala | `.scala` | Tree-sitter entities | Detection only |
| Elixir | `.ex`, `.exs` | Tree-sitter entities | Detection only |
| Dart | `.dart` | Tree-sitter entities | Detection only |
| OCaml | `.ml`, `.mli` | Tree-sitter entities | Detection only |
| Zig | `.zig` | Tree-sitter entities | Detection only |
| Bash | `.sh`, `.bash`, `.zsh` | Tree-sitter entities | Detection only |
| HTML | `.html`, `.htm` | Detection only | Detection only |
| CSS | `.css` | Detection only | Detection only |

Languages marked "Detection only" for import resolution do not yet have language-specific import resolvers but still participate in call and contains edge extraction. HTML and CSS are detected for workspace reporting but do not have entity extractors.