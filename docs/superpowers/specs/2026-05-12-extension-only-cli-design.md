# Design: Extension-Only CLI (No Direct `memory-store.js` References)

**Date:** 2026-05-12  
**Status:** Approved  
**Problem:** Users on Windows/macOS/Linux get broken instructions — `memory-store.js` isn't in PATH, `%APPDATA%` doesn't expand in Git Bash, and the tool tells users to run commands that don't work.

## Problem Statement

LaPis exposes `memory-store.js` as a bare CLI command in error messages, usage strings, and nudge notifications. But:

1. **Not in PATH** — `memory-store.js` lives inside the package at `~/.pi/agent/git/.../memory-store.js`. Calling it as a bare command returns "command not found".
2. **Windows shell mismatch** — `%APPDATA%` is a cmd.exe convention. Git Bash / MSYS2 doesn't expand it. Users had to hardcode Unix-style paths.
3. **No `bin` in package.json** — No global CLI command is registered. Adding one would require native module compilation (`better-sqlite3`) which fails on most Windows machines out of the box.

The root cause: `memory-store.js` is an **internal implementation detail**. The extension already calls it via a resolved absolute path (`MEMORY_SCRIPT = path.join(PKG_ROOT, "memory-store.js")`). The problem is that error messages and notifications expose this internal detail to users/LLMs as if it were a runnable command.

## Design Decision

**Replace all `memory-store.js` references with Pi tool references.** Users interact exclusively through `memory-code`, `memory-doc`, `memory-save`, etc. The CLI script remains but is never referenced by name.

### Why extension-only wins over standalone CLI

| Factor | Extension-only | Standalone CLI |
|--------|---------------|----------------|
| Native module compilation | Handled by `pi install` locally | Fails on Windows without build tools |
| PATH issues | None — tools are Pi-native | Must solve per-OS, per-shell |
| Windows `%APPDATA%` | Not exposed | Needs shell-aware path expansion |
| User experience | `pi install` → done | `npm install -g` + PATH + build tools |
| Maintenance | Single code path | Two paths to test and document |

## Changes Required

### 1. Add `index-repo` / `reindex-repo` / `index-docs` / `reindex-docs` modes to Pi tools

Currently `memory-code` and `memory-doc` tools have fixed mode enums that **exclude** indexing commands. When a repo isn't indexed, the tool tells the user to run `memory-store.js index-repo` — which doesn't work.

**Add to `memory-code` tool:**
- Mode `index-repo` — parameters: `path` (required), `name` (optional)
- Mode `reindex-repo` — parameters: `repo` (required), `mode` (optional: `full`|`incremental`)

**Add to `memory-doc` tool:**
- Mode `index-docs` — parameters: `path` (required), `name` (required), `ignore` (optional glob)
- Mode `reindex-docs` — parameters: `repo` (required), `mode` (optional), `ignore` (optional)

These modes map to the existing CLI subcommands — no new CLI logic needed.

### 2. Replace `memory-store.js` references in `memory-store.js` usage strings

Lines ~2445-2475 contain hardcoded `node memory-store.js` prefixes in Usage error messages:

| Current | Replacement |
|---------|-------------|
| `'Usage: node memory-store.js index-repo --path ...'` | `'Usage: index-repo --path ...'` |
| `'Usage: node memory-store.js reindex-repo --repo ...'` | `'Usage: reindex-repo --repo ...'` |
| `'Usage: node memory-store.js search-code --query ...'` | `'Usage: search-code --query ...'` |
| `'Usage: node memory-store.js get-code-source ...'` | `'Usage: get-code-source ...'` |
| `'Usage: node memory-store.js remove-code-repo ...'` | `'Usage: remove-code-repo ...'` |
| `Usage: node memory-store.js index-docs ...` | `Usage: index-docs ...` |

The `node memory-store.js` prefix is noise when the CLI is invoked internally by the extension. The actual usage pattern is the subcommand + flags.

Also fix the main fallback usage string (line ~2830):
```
Usage: node memory-store.js <subcommand> [--option value ...]
```
→
```
Usage: memory-store <subcommand> [--option value ...]
```

### 3. Replace `memory-store.js` references in `index.ts` context injection

The `before_agent_start` handler injects context that includes stale/missing index warnings:

**Stale index warning** (line ~523):
```
Run `memory-store.js reindex-repo --repo ${cwdRepo.name}` to update.
```
→
```
Run `memory-code reindex-repo --repo ${cwdRepo.name}` to update.
```

**Missing index warning** (line ~519):
```
Run `memory-store.js index-repo --path ${ctx.cwd} --name ${currentProject}` to enable memory-code analysis.
```
→
```
Run `memory-code index-repo --path ${ctx.cwd} --name ${currentProject}` to enable memory-code analysis.
```

### 4. Replace `memory-store.js` references in `index.ts` tool_call handler

**Bash block nudge** (line ~581):
```
`memory-store.js index-repo`
```
→
```
`memory-code index-repo`
```

**Read block nudge** (line ~610):
```
`memory-store.js index-repo`
```
→
```
`memory-code index-repo`
```

### 5. Replace `memory-store.js` references in `index.ts` memory-code tool `execute`

**Repo not indexed error** (line ~1469):
```
`memory-store.js index-repo --path ${cwd} --name ${params.repo}`
```
→
```
`memory-code index-repo --path ${cwd} --name ${params.repo}`
```

**memory-doc tool doc repo not indexed error** (line ~1530):
```
`memory-store.js index-docs --path ${cwd} --name ${params.repo}`
```
→
```
`memory-doc index-docs --path ${cwd} --name ${params.repo}`
```

### 6. Replace `memory-store.js` references in `index.ts` tool descriptions

**memory-code tool description** (line ~1441):
```
"Requires the repo to be indexed first (use `memory-store.js index-repo`)."
```
→
```
"Requires the repo to be indexed first (use mode `index-repo`)."
```

**memory-doc tool description** (line ~1506):
```
"Requires docs to be indexed first (use `memory-store.js index-docs`)."
```
→
```
"Requires docs to be indexed first (use mode `index-docs`)."
```

### 7. Update AGENTS.md templates

Both `AGENTS.md` files contain inline templates that reference `memory-store.js`:
- The stale index warning example at the bottom of auto-loaded context
- The `memory-store.js reindex-repo` command suggestion

Replace with `memory-code reindex-repo` / `memory-code index-repo`.

### 8. No `package.json` bin field needed

The extension calls `memory-store.js` via resolved absolute path. No global CLI registration is required or desirable (avoids native module compilation issues).

## Files Modified

| File | Changes |
|------|---------|
| `memory-store.js` | Strip `node memory-store.js` prefix from 6 Usage strings + main fallback |
| `index.ts` | Add `index-repo`/`reindex-repo` modes to `memory-code`, add `index-docs`/`reindex-docs` modes to `memory-doc`, replace 6 `memory-store.js` refs with tool refs, update 2 tool descriptions |
| `AGENTS.md` (LaPis) | Replace `memory-store.js` refs in protocol docs |
| `AGENTS.md` (PiMemoryExtension) | Replace `memory-store.js` refs in protocol docs |
| `README.md` | Verify no direct CLI commands remain (current content looks clean) |

## Out of Scope

- `package.json` bin field — adding a standalone CLI is explicitly rejected
- Windows `%APPDATA%` path handling — not needed when everything goes through Pi tools
- `config.js` path resolution — already works correctly via `process.env.HOME || process.env.USERPROFILE || os.homedir()`

## Testing

- Verify `memory-code index-repo --path . --name TestRepo` works through the tool
- Verify `memory-code reindex-repo --repo TestRepo` works through the tool
- Verify `memory-doc index-docs --path ./docs --name TestDocs` works through the tool
- Verify stale/missing index warnings show `memory-code` references, not `memory-store.js`
- Verify error messages from CLI usage strings no longer contain `node memory-store.js`