# Configuration Guide

This guide covers configuration for the LaPis memory layer extension.

## Setup

LaPis does not install npm dependencies during Pi startup or database access. Install dependencies explicitly when running from a local checkout:

```bash
npm install
```

If the local SQLite/libSQL dependency is missing, LaPis reports the missing dependency and the command to run instead of attempting a runtime install.

## Config File

LaPis reads optional JSONC configuration from:

```text
~/.pi/memory/config.jsonc
```

Supported settings include:

```jsonc
{
  "db_path": "~/.pi/memory/memory.db",
  "wal_autocheckpoint": 1000,
  "busy_timeout_ms": 5000,
  "ranking": {
    "fts_relevance": 0.4,
    "recency": 0.3,
    "trust": 0.15,
    "recall": 0.15
  },
  "dedup": {
    "auto_merge_threshold": 0.85,
    "warning_threshold": 0.6
  },
  "compact_every_n_sessions": 5,
  "context_limit": 5,
  "tier_config_path": "~/.pi/memory/tier.jsonc"
}
```

## What Gets Stored

LaPis stores data locally in the configured SQLite database. It can store:

- Explicit memories saved through `memory-save` or the `save` CLI command.
- Session lifecycle records, summaries, recall metadata, and context ranking signals.
- Edited-file checkpoints containing file paths and brief progress metadata.
- Auto-detected assistant decisions, bugfix notes, discoveries, and constraints inferred from assistant messages.
- Indexed code/documentation metadata for repositories explicitly indexed with `memory-code` and `memory-doc`.
- Code index diagnostics, including parse errors, zero-symbol files, freshness, and index health signals.
- Symbol links and trust scores used to reduce confidence when linked code changes.

## Dream Cycle

The Dream Cycle is configured through the session cadence settings above and runs memory-quality cleanup after session end. See [`DREAM_CYCLE.md`](DREAM_CYCLE.md) for the cleanup policy and stale-memory criteria.

## Glossary

- **Agent** — An autonomous process that can store and retrieve memories.
- **Context Window** — The limited amount of information an AI can process at once.
- **Dream Cycle** — Periodic cleanup that removes stale, superseded, or low-value memories.

## See Also

See [SKILL.md](SKILL.md) for the main skill documentation.
