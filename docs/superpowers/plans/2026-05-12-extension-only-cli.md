# Extension-Only CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all direct `memory-store.js` CLI references with Pi tool references so users never need to run the CLI manually.

**Architecture:** Add `index-repo`/`reindex-repo` modes to `memory-code` and `index-docs`/`reindex-docs` modes to `memory-doc`, then replace all `memory-store.js` references in error messages, nudges, and tool descriptions with the corresponding Pi tool invocations. The CLI script remains unchanged internally — only the user-facing strings change.

**Tech Stack:** TypeScript (index.ts), JavaScript (memory-store.js), Markdown (AGENTS.md)

---

### Task 1: Add `index-repo` and `reindex-repo` modes to `memory-code` tool

**Files:**
- Modify: `index.ts:1431-1475` (memory-code tool definition)

The `memory-code` tool currently has a fixed `mode` enum that excludes indexing commands. This means when a repo isn't indexed, the tool can't fix the problem itself — it just tells the user to run `memory-store.js` (which doesn't work).

- [ ] **Step 1: Add `index-repo` and `reindex-repo` to the mode enum and cmdMap**

In `index.ts`, update the `memory-code` tool's mode enum and `cmdMap`:

```typescript
// In the mode enum (Type.String with enum array):
enum: ["callers", "callees", "blast-radius", "dead-code", "complexity", "deps", "outline", "churn", "hotspots", "cycles", "importance", "coupling", "extractable", "hierarchy", "signal-chains", "layer-violations", "index-repo", "reindex-repo"],

// In the cmdMap inside execute():
const cmdMap: Record<string, string> = {
  callers: "call-hierarchy",
  callees: "call-hierarchy",
  "blast-radius": "blast-radius",
  "dead-code": "dead-code",
  complexity: "complexity",
  deps: "import-graph",
  outline: "outline",
  churn: "churn",
  hotspots: "hotspots",
  cycles: "cycles",
  importance: "importance",
  coupling: "coupling",
  extractable: "extractable",
  hierarchy: "hierarchy",
  "signal-chains": "signal-chains",
  "layer-violations": "layer-violations",
  "index-repo": "index-repo",
  "reindex-repo": "reindex-repo",
};
```

- [ ] **Step 2: Add `path` and `name` parameters to the `memory-code` tool schema**

The `index-repo` mode needs `path` (required) and `name` (optional). The `reindex-repo` mode uses existing `repo` parameter. Add these as optional parameters:

```typescript
// Add to parameters Type.Object:
path: Type.Optional(Type.String({ description: "Local path to repo directory (required for index-repo mode)" })),
name: Type.Optional(Type.String({ description: "Repo name for indexing (defaults to directory basename)" })),
```

- [ ] **Step 3: Handle `index-repo` and `reindex-repo` args in the execute function**

After the `if (params.rules)` line in execute, add arg wiring for the new modes:

```typescript
if (params.path) args.path = params.path;
if (params.name) args.name = params.name;
```

Also, **skip the repo-indexed check** for `index-repo` mode (the whole point is to index a new repo). Add at the start of the repo check block:

```typescript
// Skip repo check for indexing modes — they CREATE the repo entry
if (params.mode === "index-repo" || params.mode === "reindex-repo") {
  const result = await mem(cmd, args);
  if (!result) return { content: [{ type: "text", text: "Indexing failed or timed out." }], details: {}, isError: true };
  if (result.error) return { content: [{ type: "text", text: `Error: ${result.error}` }], details: result, isError: true };
  const fmt = formatCodeResult(params.mode, result);
  return { content: [{ type: "text", text: fmt }], details: result };
}
```

- [ ] **Step 4: Add formatCodeResult cases for `index-repo` and `reindex-repo`**

In the `formatCodeResult` function, add cases before `default:`:

```typescript
case "index-repo": {
  if (result.error) return `Error: ${result.error}`;
  return `✅ Repo "${result.name || result.repo}" indexed: ${result.file_count || 0} files, ${result.symbol_count || 0} symbols`;
}
case "reindex-repo": {
  if (result.error) return `Error: ${result.error}`;
  return `✅ Repo "${result.name || result.repo}" reindexed: ${result.file_count || 0} files, ${result.symbol_count || 0} symbols (${result.mode || 'incremental'})`;
}
```

- [ ] **Step 5: Run existing tests to verify no breakage**

Run: `npx vitest run`
Expected: All tests pass — we only added to the enum and cmdMap, existing modes unchanged

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat: add index-repo/reindex-repo modes to memory-code tool"
```

---

### Task 2: Add `index-docs` and `reindex-docs` modes to `memory-doc` tool

**Files:**
- Modify: `index.ts:1506-1554` (memory-doc tool definition)

Same pattern as Task 1 but for doc indexing.

- [ ] **Step 1: Add `index-docs` and `reindex-docs` to the mode enum and cmdMap**

```typescript
// In the mode enum:
enum: ["search", "outline", "backlinks", "broken-links", "glossary", "tutorial-path", "code-examples", "orphans", "coverage", "stale-pages", "duplicates", "index-docs", "reindex-docs"],

// In the cmdMap inside execute():
const cmdMap: Record<string, string> = {
  search: "doc-search",
  outline: "doc-outline",
  backlinks: "backlinks",
  "broken-links": "broken-links",
  glossary: "glossary",
  "tutorial-path": "tutorial-path",
  "code-examples": "code-examples",
  orphans: "doc-orphans",
  coverage: "doc-coverage",
  "stale-pages": "stale-pages",
  duplicates: "doc-duplicates",
  "index-docs": "index-docs",
  "reindex-docs": "reindex-docs",
};
```

- [ ] **Step 2: Add `ignore` parameter to `memory-doc` schema**

The `index-docs` CLI subcommand accepts `--ignore GLOB`. Add it:

```typescript
// Add to parameters Type.Object:
ignore: Type.Optional(Type.String({ description: "Glob pattern to ignore during doc indexing" })),
```

- [ ] **Step 3: Handle `index-docs` and `reindex-docs` args in execute**

Wire the new args. The `index-docs` mode needs `path` and `name` (both already in schema from Task 1 — wait, those are on `memory-code`, not `memory-doc`). Add to `memory-doc`:

```typescript
// Add path and name parameters to memory-doc tool schema:
path: Type.Optional(Type.String({ description: "Local path to docs directory (required for index-docs mode)" })),
name: Type.Optional(Type.String({ description: "Doc repo name (required for index-docs mode)" })),
```

In the args wiring:
```typescript
if (params.path) args.path = params.path;
if (params.name) args.name = params.name;
if (params.ignore) args.ignore = params.ignore;
```

Skip the doc repo check for indexing modes:
```typescript
if (params.mode === "index-docs" || params.mode === "reindex-docs") {
  const result = await mem(cmd, args);
  if (!result) return { content: [{ type: "text", text: "Doc indexing failed or timed out." }], details: {}, isError: true };
  if (result.error) return { content: [{ type: "text", text: `Error: ${result.error}` }], details: result, isError: true };
  const fmt = formatDocResult(params.mode, result);
  return { content: [{ type: "text", text: fmt }], details: result };
}
```

- [ ] **Step 4: Add formatDocResult cases for `index-docs` and `reindex-docs`**

```typescript
case "index-docs": {
  if (result.error) return `Error: ${result.error}`;
  return `✅ Doc repo "${result.name || params.name}" indexed: ${result.section_count || 0} sections in ${result.file_count || 0} files`;
}
case "reindex-docs": {
  if (result.error) return `Error: ${result.error}`;
  return `✅ Doc repo "${result.name || params.repo}" reindexed: ${result.section_count || 0} sections (${result.mode || 'full'})`;
}
```

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "feat: add index-docs/reindex-docs modes to memory-doc tool"
```

---

### Task 3: Replace `memory-store.js` references in `index.ts` context injection and nudges

**Files:**
- Modify: `index.ts` (6 locations)

These are the user-visible strings that tell the LLM/user to run `memory-store.js` — the core of the bug report.

- [ ] **Step 1: Replace stale index warning in `before_agent_start`**

Find:
```
Run \`memory-store.js reindex-repo --repo ${cwdRepo.name}\` to update.
```
Replace with:
```
Run \`memory-code reindex-repo --repo ${cwdRepo.name}\` to update.
```

- [ ] **Step 2: Replace missing index warning in `before_agent_start`**

Find:
```
Run \`memory-store.js index-repo --path ${ctx.cwd} --name ${currentProject}\` to enable memory-code analysis.
```
Replace with:
```
Run \`memory-code index-repo --path ${ctx.cwd} --name ${currentProject}\` to enable memory-code analysis.
```

- [ ] **Step 3: Replace bash block nudge in `tool_call` handler**

Find:
```
`memory-store.js index-repo`
```
Replace with:
```
`memory-code index-repo`
```

- [ ] **Step 4: Replace read block nudge in `tool_call` handler**

Find:
```
`memory-store.js index-repo`
```
Replace with:
```
`memory-code index-repo`
```

- [ ] **Step 5: Replace repo-not-found error in `memory-code` execute**

Find:
```
`memory-store.js index-repo --path ${cwd} --name ${params.repo}`
```
Replace with:
```
`memory-code index-repo --path ${cwd} --name ${params.repo}`
```

- [ ] **Step 6: Replace doc-repo-not-found error in `memory-doc` execute**

Find:
```
`memory-store.js index-docs --path ${cwd} --name ${params.repo}`
```
Replace with:
```
`memory-doc index-docs --path ${cwd} --name ${params.repo}`
```

- [ ] **Step 7: Replace `memory-code` tool description**

Find:
```
"Requires the repo to be indexed first (use `memory-store.js index-repo`)."
```
Replace with:
```
"Requires the repo to be indexed first (use mode `index-repo`)."
```

- [ ] **Step 8: Replace `memory-doc` tool description**

Find:
```
"Requires docs to be indexed first (use `memory-store.js index-docs`)."
```
Replace with:
```
"Requires docs to be indexed first (use mode `index-docs`)."
```

- [ ] **Step 9: Run existing tests**

Run: `npx vitest run`
Expected: All tests pass (these are string-only changes)

- [ ] **Step 10: Commit**

```bash
git add index.ts
git commit -m "fix: replace memory-store.js refs with Pi tool refs in index.ts"
```

---

### Task 4: Strip `node memory-store.js` prefix from CLI usage strings

**Files:**
- Modify: `memory-store.js` (8 locations)

The CLI's error messages contain `node memory-store.js` as a prefix, which is noise when invoked internally and confusing when shown to users. Strip it.

- [ ] **Step 1: Replace `index-repo` usage string**

Find:
```javascript
return jsonErrNoExit('Usage: node memory-store.js index-repo --path <path> [--name NAME]');
```
Replace with:
```javascript
return jsonErrNoExit('Usage: index-repo --path <path> [--name NAME]');
```

- [ ] **Step 2: Replace `reindex-repo` usage string**

Find:
```javascript
return jsonErrNoExit('Usage: node memory-store.js reindex-repo --repo <repo-name> [--mode full|incremental]');
```
Replace with:
```javascript
return jsonErrNoExit('Usage: reindex-repo --repo <repo-name> [--mode full|incremental]');
```

- [ ] **Step 3: Replace `search-code` usage string**

Find:
```javascript
return jsonErrNoExit(
  'Usage: node memory-store.js search-code --query <text> [--repo NAME] [--kind TYPE] [--max-results N]',
);
```
Replace with:
```javascript
return jsonErrNoExit(
  'Usage: search-code --query <text> [--repo NAME] [--kind TYPE] [--max-results N]',
);
```

- [ ] **Step 4: Replace `get-code-source` usage string**

Find:
```javascript
return jsonErrNoExit('Usage: node memory-store.js get-code-source --repo NAME --file PATH --name SYMBOL');
```
Replace with:
```javascript
return jsonErrNoExit('Usage: get-code-source --repo NAME --file PATH --name SYMBOL');
```

- [ ] **Step 5: Replace `remove-code-repo` usage string**

Find:
```javascript
return jsonErrNoExit('Usage: node memory-store.js remove-code-repo --repo <repo-name>');
```
Replace with:
```javascript
return jsonErrNoExit('Usage: remove-code-repo --repo <repo-name>');
```

- [ ] **Step 6: Replace `index-docs` usage string**

Find:
```javascript
return jsonErrNoExit('Usage: node memory-store.js index-docs --path P --name X [--ignore GLOB]');
```
Replace with:
```javascript
return jsonErrNoExit('Usage: index-docs --path P --name X [--ignore GLOB]');
```

- [ ] **Step 7: Replace main fallback usage string**

Find:
```javascript
console.error(
  `Usage: node memory-store.js <subcommand> [--option value ...]\n` +
    `Subcommands: ${Object.keys(commands).join(', ')}`,
);
```
Replace with:
```javascript
console.error(
  `Usage: memory-store <subcommand> [--option value ...]\n` +
    `Subcommands: ${Object.keys(commands).join(', ')}`,
);
```

- [ ] **Step 8: Run existing tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add memory-store.js
git commit -m "fix: strip 'node memory-store.js' prefix from CLI usage strings"
```

---

### Task 5: Update AGENTS.md mode lists

**Files:**
- Modify: `AGENTS.md` (PiMemoryExtension repo root)

The AGENTS.md mode lists for `memory-code` and `memory-doc` need the new modes documented.

- [ ] **Step 1: Add indexing modes to memory-code mode list**

Find:
```
  - Modes: callers, callees, blast-radius, dead-code, complexity, deps, outline, churn, hotspots, cycles, importance, coupling, extractable, hierarchy, signal-chains, layer-violations
```
Replace with:
```
  - Modes: callers, callees, blast-radius, dead-code, complexity, deps, outline, churn, hotspots, cycles, importance, coupling, extractable, hierarchy, signal-chains, layer-violations, index-repo, reindex-repo
```

- [ ] **Step 2: Add indexing modes to memory-doc mode list**

Find:
```
  - Modes: search, outline, backlinks, broken-links, glossary, tutorial-path, code-examples, orphans, coverage, stale-pages, duplicates
```
Replace with:
```
  - Modes: search, outline, backlinks, broken-links, glossary, tutorial-path, code-examples, orphans, coverage, stale-pages, duplicates, index-docs, reindex-docs
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add index-repo/reindex-repo/index-docs/reindex-docs to AGENTS.md mode lists"
```

---

### Task 6: Verify no remaining `memory-store.js` user-facing references

**Files:**
- Scan all files in the repo

Final sweep to make sure nothing was missed.

- [ ] **Step 1: Search for remaining `memory-store.js` references in user-facing strings**

Search the entire repo for `memory-store.js` in non-code context (markdown, comments, string literals). The only acceptable remaining references are:
- `MEMORY_SCRIPT = path.join(PKG_ROOT, "memory-store.js")` — internal path resolution
- Code comments/doc references that describe the internal architecture
- `package.json` `"main": "memory-store.js"` — npm entry point
- `if (input.path.includes("memory-store.js"))` in `tool_result` handler — internal file exclusion

Any reference that tells a user to *run* `memory-store.js` as a command must be replaced.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit any cleanup changes**

```bash
git add -A
git commit -m "chore: final cleanup of memory-store.js user-facing references"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Change 1 (new tool modes) → Tasks 1 & 2
- ✅ Change 2 (CLI usage strings) → Task 4
- ✅ Change 3 (context injection warnings) → Task 3, steps 1-2
- ✅ Change 4 (tool_call nudges) → Task 3, steps 3-4
- ✅ Change 5 (tool execute errors) → Task 3, steps 5-6
- ✅ Change 6 (tool descriptions) → Task 3, steps 7-8
- ✅ Change 7 (AGENTS.md) → Task 5
- ✅ Change 8 (no bin field) → implicitly handled by not adding one
- All spec requirements mapped to tasks ✅

**2. Placeholder scan:** No TBD/TODO found ✅

**3. Type consistency:** Mode names (`index-repo`, `reindex-repo`, `index-docs`, `reindex-docs`) used consistently across Tasks 1-5. Parameter names (`path`, `name`, `ignore`) match between tool schemas and CLI subcommands ✅