# Crosshash Migration Strategy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate Crosshash against the JS code-index/code-analysis path using the decision framework from `ARCHITECTURE_MODULARIZATION.md` §9 and produce a decision record at `docs/decisions/crosshash-strategy.md`.

**Architecture:** This is a decision-only issue (no production code changes). The work involves (1) fixing Crosshash's build so it can be evaluated, (2) benchmarking and comparing against the JS path across the 7 criteria, (3) producing the decision record using the template from the issue. The final deliverable is a single markdown document plus any benchmark scripts/data produced during evaluation.

**Tech Stack:** Rust/Cargo (Crosshash), Node.js (LaPis JS path), Bash for benchmark scripts, SQLite for storage comparison.

---

## Context: What we're comparing

### JS `memory-code` analysis modes (17 modes)
The current JS path supports these modes via `memory-store.js`:
`callers`, `callees`, `blast-radius`, `dead-code`, `complexity`, `deps`, `outline`, `churn`, `hotspots`, `cycles`, `importance`, `coupling`, `extractable`, `hierarchy`, `signal-chains`, `layer-violations`, plus `index-repo` and `reindex-repo`.

Backends: `parse-code.js` (1040 loc tree-sitter parsing), `code-analysis.js`, `git-analysis.js` (303 loc), `ast-patterns.js` (421 loc). Total ~1919 loc across 5 JS files.

### Crosshash Rust workspace (10 crates)
Located at `crosshash/` on the `v1.0.0` branch. Crates: `crosshash-core`, `crosshash-parser`, `crosshash-hash`, `crosshash-graph`, `crosshash-git`, `crosshash-cli`, `crosshash-ai`, `crosshash-impact`, `crosshash-api` (Axum HTTP), `crosshash-mcp` (MCP stdio).

MCP tools (9): `crosshash_index`, `crosshash_list_repos`, `crosshash_impact`, `crosshash_entity_lookup`, `crosshash_entity_context`, `crosshash_graph_traverse`, `crosshash_discover_edges`, `crosshash_diff`, `crosshash_feedback`.

CLI subcommands: `repo {add,list,remove,info}`, `index`, `discover-edges`, `impact`, `entity {lookup,hash}`, `graph {callers,callees,blast-radius,cycles,validate-edges,path-between}`, `feedback`, `ai-stats`, `serve`, `watch`, `mcp`.

Languages: 21 detected, 19 with entity extraction, 14 with import resolution.

---

## File Structure

| File | Purpose |
|---|---|
| Create: `docs/decisions/crosshash-strategy.md` | Final decision record document |
| Create: `scripts/crosshash-benchmark.sh` | Benchmarking script for indexing and query latency |
| Create: `scripts/crosshash-parity-check.sh` | Feature parity comparison script |
| Modify: (none — this is a decision-only issue) | |

---

### Task 1: Fix Crosshash build

**Files:**
- Modify: `crosshash/crates/crosshash-parser/Cargo.toml` (dependency version)
- Reference: `crosshash/Cargo.lock`

**Why:** Crosshash currently fails to build due to `tree-sitter-kotlin = "^0.1"` — crates.io only has `0.3.x`. This blocks all evaluation work.

- [ ] **Step 1: Identify all broken dependency versions**

```bash
cd crosshash
cargo check --workspace 2>&1 | grep "failed to select a version"
```

Expected: At minimum `tree-sitter-kotlin` version mismatch. May find others.

- [ ] **Step 2: Fix tree-sitter-kotlin version**

Open `crosshash/crates/crosshash-parser/Cargo.toml` and change:
```toml
# Before
tree-sitter-kotlin = "0.1"
# After
tree-sitter-kotlin = "0.3"
```

Also update `crosshash/Cargo.toml` workspace dependency if present:
```toml
# Before
tree-sitter-kotlin = "0.1"
# After
tree-sitter-kotlin = "0.3"
```

- [ ] **Step 3: Verify build succeeds**

```bash
cd crosshash
cargo check --workspace 2>&1
```

Expected: `Finished dev [unoptimized + debuginfo]` with no errors.

- [ ] **Step 4: Run existing tests**

```bash
cd crosshash
cargo test --workspace 2>&1
```

Expected: All tests pass. Note the test count — this feeds the "Stability" criterion.

- [ ] **Step 5: Commit the fix**

```bash
git add crosshash/crates/crosshash-parser/Cargo.toml crosshash/Cargo.toml crosshash/Cargo.lock
git commit -m "fix(crosshash): update tree-sitter-kotlin to 0.3 for crates.io compat"
```

---

### Task 2: Run Crosshash CLI smoke test

**Files:**
- Reference: `crosshash/` workspace
- Test target: the `PiMemoryExtension` repo itself (~50k lines across all files)

- [ ] **Step 1: Build release binary**

```bash
cd crosshash
cargo build --release -p crosshash-cli 2>&1
```

Expected: Binary at `target/release/crosshash`.

- [ ] **Step 2: Add the PiMemoryExtension repo**

```bash
./target/release/crosshash --format json repo add /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension --name lapis-self --workspace-aware
```

Expected: `{"status":"ok","repo":{...}}`.

- [ ] **Step 3: Index the repo (no AI)**

```bash
time ./target/release/crosshash --format json index --repo lapis-self --no-ai
```

Expected: Success. Record wall-clock time — this is the **Rust indexing benchmark**.

- [ ] **Step 4: Run graph queries**

```bash
./target/release/crosshash --format json graph callers --name memoryStore --repo lapis-self --depth 2
./target/release/crosshash --format json graph callees --name memoryStore --repo lapis-self --depth 2
./target/release/crosshash --format json graph blast-radius --name handleCommand --repo lapis-self
./target/release/crosshash --format json graph cycles --repo lapis-self
```

Expected: JSON results for each. Record wall-clock time per query.

- [ ] **Step 5: Record smoke-test results**

Write results to a temporary file for reference:

```bash
cat > /tmp/crosshash-smoke-results.md << 'EOF'
# Crosshash Smoke Test Results

Date: $(date -I)
Repo: PiMemoryExtension

## Build
- Binary size: $(du -h target/release/crosshash | cut -f1)
- Build time: [fill in]

## Indexing
- Wall-clock: [fill in]
- Entities extracted: [fill in]
- Edges extracted: [fill in]

## Queries
- callers (memoryStore, depth 2): [time]
- callees (memoryStore, depth 2): [time]
- blast-radius (handleCommand): [time]
- cycles: [time]
EOF
```

---

### Task 3: Benchmark JS path for comparison

**Files:**
- Create: `scripts/crosshash-benchmark.sh`

- [ ] **Step 1: Write benchmark script**

```bash
cat > scripts/crosshash-benchmark.sh << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="$(cd "$(dirname "$0")/.." && pwd)"
REPO_NAME="PiMemoryExtension"

echo "=== JS memory-code Benchmark ==="
echo "Date: $(date -I)"
echo "Repo: $REPO_NAME"
echo

# Indexing
echo "--- index-repo ---"
time node "$REPO_PATH/memory-store.js" index-repo --path "$REPO_PATH" --name "$REPO_NAME" 2>&1

# Queries
echo
echo "--- outline ---"
time node "$REPO_PATH/memory-store.js" outline --repo "$REPO_NAME" --file memory-store.js 2>&1 | tail -5

echo
echo "--- callers ---"
time node "$REPO_PATH/memory-store.js" callers --repo "$REPO_NAME" --symbol memoryStore 2>&1 | tail -5

echo
echo "--- deps ---"
time node "$REPO_PATH/memory-store.js" deps --repo "$REPO_NAME" 2>&1 | tail -5

echo
echo "--- cycles ---"
time node "$REPO_PATH/memory-store.js" cycles --repo "$REPO_NAME" 2>&1 | tail -5

echo
echo "--- importance ---"
time node "$REPO_PATH/memory-store.js" importance --repo "$REPO_NAME" 2>&1 | tail -5

echo
echo "--- dead-code ---"
time node "$REPO_PATH/memory-store.js" dead-code --repo "$REPO_NAME" 2>&1 | tail -5

echo
echo "=== Benchmark Complete ==="
SCRIPT
chmod +x scripts/crosshash-benchmark.sh
```

- [ ] **Step 2: Run JS benchmark**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension
bash scripts/crosshash-benchmark.sh 2>&1 | tee /tmp/js-benchmark-results.txt
```

Expected: Timings for each operation. Record for comparison.

- [ ] **Step 3: Commit benchmark script**

```bash
git add scripts/crosshash-benchmark.sh
git commit -m "chore: add JS vs Crosshash benchmark script for issue #85"
```

---

### Task 4: Evaluate feature parity

**Files:**
- Create: `scripts/crosshash-parity-check.sh`

- [ ] **Step 1: Write parity comparison script**

```bash
cat > scripts/crosshash-parity-check.sh << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

echo "=== memory-code Mode vs Crosshash Feature Parity ==="
echo "Date: $(date -I)"
echo
echo "| # | memory-code mode | Crosshash equivalent | Parity |"
echo "|---|---|---|---|"
echo "| 1 | index-repo | crosshash_index | ? |"
echo "| 2 | reindex-repo | crosshash_index --incremental | ? |"
echo "| 3 | callers | graph callers | ? |"
echo "| 4 | callees | graph callees | ? |"
echo "| 5 | blast-radius | graph blast-radius | ? |"
echo "| 6 | dead-code | NO EQUIVALENT | ? |"
echo "| 7 | complexity | NO EQUIVALENT | ? |"
echo "| 8 | deps | NO EQUIVALENT (import graph) | ? |"
echo "| 9 | outline | NO EQUIVALENT | ? |"
echo "| 10 | churn | NO EQUIVALENT (git churn) | ? |"
echo "| 11 | hotspots | NO EQUIVALENT | ? |"
echo "| 12 | cycles | graph cycles | ? |"
echo "| 13 | importance | NO EQUIVALENT | ? |"
echo "| 14 | coupling | NO EQUIVALENT | ? |"
echo "| 15 | extractable | NO EQUIVALENT | ? |"
echo "| 16 | hierarchy | NO EQUIVALENT (class hierarchy) | ? |"
echo "| 17 | signal-chains | NO EQUIVALENT | ? |"
echo "| 18 | layer-violations | NO EQUIVALENT | ? |"
echo
echo "Run the Crosshash smoke test and fill in ? with FULL/PARTIAL/NONE"
SCRIPT
chmod +x scripts/crosshash-parity-check.sh
```

- [ ] **Step 2: Run parity check and fill in results**

Run the Crosshash CLI from Task 2 against the indexed repo. For each mode, determine if Crosshash can produce equivalent output:

```bash
# Check callers parity
./target/release/crosshash --format json graph callers --name memoryStore --repo lapis-self --depth 3

# Check cycles parity
./target/release/crosshash --format json graph cycles --repo lapis-self

# Check that dead-code, complexity, etc. are truly missing
./target/release/crosshash --help 2>&1 | grep -i "dead\|complexity\|outline\|churn\|hotspot\|importance\|coupling\|extract\|hierarchy\|signal\|layer"
```

Expected: Confirms that Crosshash covers ~4/17 analysis modes directly (callers, callees, blast-radius, cycles). The remaining 13 have no equivalent.

- [ ] **Step 3: Commit parity script**

```bash
git add scripts/crosshash-parity-check.sh
git commit -m "chore: add feature parity comparison script for issue #85"
```

---

### Task 5: Evaluate Pi extension compatibility

**Files:**
- Reference: `extensions/memory-layer/index.ts`
- Reference: `crosshash/crates/crosshash-mcp/`

- [ ] **Step 1: Document how memory-code currently works in the Pi extension**

The `memory-code` tool in `extensions/memory-layer/index.ts` shells out to `node memory-store.js <mode>` with arguments. The extension captures stdout JSON and returns it to the LLM.

Record the invocation pattern:
```
spawn: node memory-store.js <mode> --repo <name> [--symbol <sym>] [--file <path>] [options]
```

- [ ] **Step 2: Document how Crosshash could be invoked**

Crosshash has three integration surfaces:

1. **CLI subprocess**: `crosshash --format json graph callers --name X --repo Y --depth 2`
   - Same pattern as current JS path. Drop-in replacement for graph queries.
   - Requires `crosshash` binary on PATH.

2. **MCP stdio**: `crosshash mcp` starts a JSON-RPC stdio server.
   - Pi extension could start Crosshash as a child process and send MCP requests.
   - Requires MCP client implementation in the extension.

3. **HTTP API**: `crosshash serve --addr 127.0.0.1:3000`
   - Axum-based HTTP server.
   - Requires HTTP client in extension. Network overhead.
   - Best for multi-extension or remote scenarios.

- [ ] **Step 3: Assess each integration boundary**

| Boundary | Pros | Cons |
|---|---|---|
| CLI subprocess | Zero code change pattern, drop-in | Process spawn per query, startup latency |
| MCP stdio | Persistent connection, structured protocol | Need MCP client code, Crosshash must stay alive |
| HTTP API | Language-agnostic, remote-capable | Network overhead, port management |
| Node native addon (napi) | Fastest, no process boundary | Complex build, cross-compilation |

- [ ] **Step 4: Record compatibility assessment**

No file to write yet — this feeds into the decision record in Task 8.

---

### Task 6: Assess maintenance burden and ecosystem risk

**Files:**
- Reference: JS code files, Crosshash Rust files

- [ ] **Step 1: Count duplicated logic**

JS path code volumes:
```
parse-code.js:    1040 loc  (tree-sitter parsing, symbol extraction)
code-analysis.js: (dispatches to git-analysis, ast-patterns, etc.)
git-analysis.js:   303 loc  (churn, provenance)
ast-patterns.js:   421 loc  (AST pattern scans)
utils.js:          154 loc  (file walking, hashing, ignores)
```

Crosshash equivalent (Rust):
```
crosshash-parser:  entity extraction, language detection, 19 language extractors
crosshash-hash:    BLAKE3 content hashing
crosshash-graph:   SQLite storage, edge extraction, graph traversal
crosshash-git:     git operations via libgit2
crosshash-impact:  impact analysis (hash diff + BFS + classification)
```

Record: What concepts overlap? Symbol extraction, import/call edges, graph traversal, incremental hashing, file walking/ignore. What's JS-only? Dead-code detection, complexity scoring, hotspot analysis, coupling metrics, class hierarchy, signal chains, layer violations.

- [ ] **Step 2: Assess ecosystem risk**

```bash
# Check Rust toolchain requirement
rustc --version
cargo --version

# Check if cross-compilation is needed for Pi environments
# Pi Agent runs on: Linux (x86_64), macOS (ARM + x86_64), potentially Windows
# Crosshash needs: Rust stable toolchain, C compiler (for tree-sitter native deps), SQLite (bundled via rusqlite)
```

Key risk factors:
- Pi Agent environments may not have Rust toolchain installed
- Binary distribution needed (pre-built binaries per platform)
- `rusqlite` bundles SQLite but needs C compiler for build
- Tree-sitter grammars are native C code — needs compilation
- Binary size: Rust release binary with 19 tree-sitter grammars could be 20-50MB

- [ ] **Step 3: Record findings**

No file to write yet — feeds into Task 8.

---

### Task 7: Assess stability

**Files:**
- Reference: Crosshash test suite results from Task 1

- [ ] **Step 1: Run Crosshash test suite and record results**

```bash
cd crosshash
cargo test --workspace 2>&1 | tee /tmp/crosshash-test-results.txt
echo "Test count: $(grep -c 'test result' /tmp/crosshash-test-results.txt)"
echo "Passed: $(grep 'test result' /tmp/crosshash-test-results.txt)"
```

Expected: Record number of tests, passed, failed.

- [ ] **Step 2: Run JS test suite for comparison**

```bash
cd /home/genegulanesjr/Documents/GulanesKorp/PiMemoryExtension
npm test 2>&1 | tail -20
```

Expected: JS test count and pass rate for comparison.

- [ ] **Step 3: Check Crosshash test coverage areas**

```bash
# Check which crates have tests
for crate in crosshash-{core,parser,hash,graph,git,cli,ai,impact,api,mcp}; do
  count=$(grep -r "#\[test\]" "crosshash/crates/$crate/" 2>/dev/null | wc -l)
  echo "$crate: $count tests"
done
```

Expected: Shows which crates are well-tested and which are sparse.

---

### Task 8: Write the decision record

**Files:**
- Create: `docs/decisions/crosshash-strategy.md`

- [ ] **Step 1: Gather all evaluation data**

Collect from Tasks 2-7:
- Benchmark timings (JS vs Rust)
- Feature parity matrix
- Integration boundary assessment
- LOC duplication analysis
- Test coverage comparison
- Ecosystem risk assessment

- [ ] **Step 2: Score each criterion**

Using the framework from `ARCHITECTURE_MODULARIZATION.md` §9:

| Criterion | Weight | Finding | Score (1-5) |
|---|---|---|---|
| Feature parity | High | Crosshash covers 4/17 analysis modes directly (callers, callees, blast-radius, cycles). Missing: dead-code, complexity, deps, outline, churn, hotspots, importance, coupling, extractable, hierarchy, signal-chains, layer-violations. | [fill from evaluation] |
| Performance | High | [fill from benchmarks] | [fill] |
| Pi extension compatibility | High | CLI subprocess is drop-in for graph queries. MCP stdio needs client code. No native addon. | [fill] |
| Maintenance burden | High | [fill from LOC analysis] | [fill] |
| Stability | Medium | [fill from test results] | [fill] |
| Migration cost | Medium | [fill from integration assessment] | [fill] |
| Ecosystem risk | Low | [fill from ecosystem assessment] | [fill] |

- [ ] **Step 3: Write the decision record**

```markdown
# ADR: Crosshash Migration Strategy

**Date:** 2026-05-15
**Status:** [Proposed | Accepted | Deprecated]
**Deciders:** Gene Gulanes Jr.

## Context

LaPis (PiMemoryExtension) contains two parallel code-intelligence implementations:

1. **JS path** — `parse-code.js`, `code-analysis.js`, `git-analysis.js`, `ast-patterns.js`, `utils.js` (~1919 loc). Supports 17 analysis modes via `memory-code` tool. Uses WASM tree-sitter for parsing, SQLite for storage.

2. **Crosshash Rust workspace** — 10 crates covering parsing (19 languages), BLAKE3 hashing, graph storage/traversal, git integration, AI edge discovery, impact analysis, HTTP API, MCP server. Exposes 9 MCP tools and CLI subcommands for repo management, indexing, graph queries, and impact analysis.

Both implementations share core concepts (symbol extraction, import/call edges, graph traversal, incremental indexing) but differ in scope, maturity, and deployment model.

## Evaluation

### Feature parity

| memory-code mode | Crosshash equivalent | Parity |
|---|---|---|
| index-repo | crosshash_index | FULL |
| reindex-repo | crosshash_index --incremental | PARTIAL (incremental logic differs) |
| callers | graph callers | FULL |
| callees | graph callees | FULL |
| blast-radius | graph blast-radius | FULL |
| cycles | graph cycles | FULL |
| dead-code | — | NONE |
| complexity | — | NONE |
| deps (import graph) | — | NONE |
| outline | — | NONE |
| churn | — | NONE |
| hotspots | — | NONE |
| importance | — | NONE |
| coupling | — | NONE |
| extractable | — | NONE |
| hierarchy | — | NONE |
| signal-chains | — | NONE |
| layer-violations | — | NONE |

**Score: 2/5** — Crosshash covers 5/17 modes (index, reindex, callers, callees, blast-radius, cycles) but is missing 12 analysis modes that the JS path provides.

### Performance

[Fill from benchmark results]

**Score: [TBD]/5**

### Pi extension compatibility

Crosshash offers three integration surfaces:
- **CLI subprocess**: Drop-in for current `node memory-store.js <mode>` pattern. Lowest migration cost.
- **MCP stdio**: Requires MCP client in extension. Higher upfront cost but persistent connection.
- **HTTP API**: Requires HTTP client. Network overhead. Best for remote/multi-process scenarios.

Current JS path: in-process Node.js. No spawn overhead. Shared SQLite connection.

**Score: [TBD]/5**

### Maintenance burden

[Fill from LOC and overlap analysis]

**Score: [TBD]/5**

### Stability

[Fill from test results]

**Score: [TBD]/5**

### Migration cost

[Fill from integration assessment]

**Score: [TBD]/5**

### Ecosystem risk

[Fill from ecosystem assessment]

**Score: [TBD]/5**

## Decision

**Chosen: [OPTION TBD]**

[Option A/B/C/D with rationale based on scores above]

## Integration boundary

**Type:** [CLI subprocess | MCP stdio | HTTP API | Node native addon]

**Justification:** [based on compatibility and migration cost scores]

## Next steps

1. [Follow-up issue for chosen option]
2. [Follow-up issue for chosen option]
3. [Follow-up issue for chosen option]
```

- [ ] **Step 4: Fill in all `[TBD]` placeholders with actual evaluation data**

Use data collected from Tasks 2-7 to fill every placeholder. No `[TBD]` may remain in the final document.

- [ ] **Step 5: Self-review the decision record**

Check against acceptance criteria from issue #85:
- [ ] Decision record exists at `docs/decisions/crosshash-strategy.md`
- [ ] Ownership between Node code-index/code-analysis and Crosshash is explicit
- [ ] Future issues know whether to enhance JS modules, migrate them, or wrap Crosshash
- [ ] Pi extension concerns stay in the main extension/adapters

- [ ] **Step 6: Commit the decision record**

```bash
git add docs/decisions/crosshash-strategy.md
git commit -m "docs: add crosshash migration strategy decision record (closes #85)"
```

---

### Task 9: Clean up benchmark artifacts

**Files:**
- Keep: `scripts/crosshash-benchmark.sh`, `scripts/crosshash-parity-check.sh` (useful for future reference)
- Clean: Crosshash index DB created during evaluation (if stored outside the project)

- [ ] **Step 1: Remove any temporary Crosshash database**

```bash
rm -f /tmp/crosshash-*.db .crosshash/*.db 2>/dev/null
# Also clean the Crosshash default DB location
rm -rf crosshash/.crosshash/*.db 2>/dev/null
```

- [ ] **Step 2: Commit benchmark scripts (if not already committed)**

```bash
git add scripts/crosshash-benchmark.sh scripts/crosshash-parity-check.sh
git commit -m "chore: preserve benchmark and parity scripts from issue #85 evaluation"
```

---

## Self-Review

### 1. Spec coverage

| Issue #85 requirement | Task |
|---|---|
| Feature parity evaluation | Task 4 |
| Performance comparison (50k-line repo) | Tasks 2-3 |
| Pi extension compatibility | Task 5 |
| Maintenance burden quantification | Task 6 |
| Stability (passing tests) | Task 7 |
| Migration cost estimate | Task 8 (feeds from all) |
| Ecosystem risk assessment | Task 6 |
| Select option A/B/C/D | Task 8 |
| Decision record at `docs/decisions/crosshash-strategy.md` | Task 8 |
| Decision record template fields | Task 8 |
| Ownership is explicit | Task 8 |
| Pi extension concerns stay in main extension | Task 8 |

### 2. Placeholder scan

All `[TBD]` and `[fill]` markers in Task 8 are intentional — they are filled from evaluation data in Step 4 of Task 8. The final committed document must have zero placeholders (verified in Step 5).

### 3. Type consistency

No code types to verify — this is a documentation-only plan. Tool names and mode names are consistent across all tasks.
