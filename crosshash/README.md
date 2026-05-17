# CrossHash

CrossHash is a cross-repository structural impact analysis engine. It indexes repositories with Tree-sitter, assigns each entity a 5-hash BLAKE3 identity, stores static and reviewed AI-inferred dependency edges, and answers impact queries with zero AI calls at runtime.

## Quickstart

```bash
cargo build --workspace
cargo run -p crosshash-cli -- repo add /path/to/repo --name my-api --workspace-aware
cargo run -p crosshash-cli -- index --repo my-api --no-ai
cargo run -p crosshash-cli -- discover-edges --dry-run
cargo run -p crosshash-cli -- impact --source my-api --all --output markdown
```

## Architecture

1. Parse source with Tree-sitter and language-specific extractors.
2. Store entities and edges in SQLite WAL mode.
3. Run AI edge discovery only during indexing when the gate allows it.
4. Run impact analysis as static hash diff + reverse graph BFS + rule-based classification.

## Language Support

19 languages have Tree-sitter entity extraction. See [language-support.md](docs/language-support.md) for the full matrix.

## Crates

| Crate              | Description                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| `crosshash-core`   | Shared types, error types, edge semantics                                 |
| `crosshash-parser` | Tree-sitter parsing, 5-hash BLAKE3, language detection, entity extraction |
| `crosshash-hash`   | BLAKE3 5-hash computation, incremental decisions                          |
| `crosshash-graph`  | SQLite storage, edge extraction, graph traversal, cycle detection         |
| `crosshash-git`    | Git operations via libgit2                                                |
| `crosshash-cli`    | CLI interface (clap + indicatif)                                          |
| `crosshash-ai`     | AI-gated edge discovery, LLM client, cost tracking                        |
| `crosshash-impact` | Impact analysis (hash diff + BFS + classification + SARIF)                |
| `crosshash-api`    | HTTP API (Axum)                                                           |
| `crosshash-mcp`    | MCP stdio server                                                          |

## CI

`.github/workflows/crosshash-ci.yml` runs `cargo fmt`, `cargo clippy`, `cargo test`, and `cargo build` on every push/PR touching `crosshash/`.

## Runtime Cost Rule

`crosshash impact` never calls an LLM. AI is gated to indexing/discovery workflows only.
