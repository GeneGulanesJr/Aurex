# Benchmarks

## Token efficiency benchmark

`bench/bench-tokens.js` measures how much LaPis' compact wire format reduces analysis-response size. It runs real code-analysis CLI commands against an indexed repo, compares raw JSON with `compactResponse()` output, and prints per-tool and total byte savings.

Run against the current repo:

```bash
node bench/bench-tokens.js
```

Run against another indexed repo:

```bash
node bench/bench-tokens.js --repo-path /path/to/repo --repo-name RepoName
```

Force a fresh code index before measuring:

```bash
node bench/bench-tokens.js --reindex
```

Treat the output as a current local snapshot. Results change when the repo, indexer, code-analysis commands, or compact wire format changes.

## Pi paired memory benchmark

`bench/bench-pi-paired.js` measures memory-on and memory-off as real Pi runs. It does not simulate the no-memory case.

Run:

```bash
npm run bench:pi-paired
```

By default, the harness runs memory-off first with a temporary `HOME` that copies only Pi config/auth files, then runs memory-on with your normal Pi environment.

You can override the command templates:

- `BENCH_PI_MEMORY_OFF_CMD`: vanilla Pi, no LaPis extension, no injected memory context.
- `BENCH_PI_MEMORY_ON_CMD`: Pi with LaPis extension/skills available.

Both commands should use `--no-session` so previous chat history cannot leak between runs. The no-memory command should still be allowed to read/search the repo normally; it is not a blind agent.

Template variables:

- `{prompt}`: shell-quoted task prompt
- `{task_id}`: task id
- `{repo}`: repo name from the fixture
- `{out}`: shell-quoted output file path

Override example:

```bash
BENCH_PI_MEMORY_OFF_CMD='pi --print --mode json --no-session {prompt} > {out} 2>&1' \
BENCH_PI_MEMORY_ON_CMD='pi --print --mode json --no-session {prompt} > {out} 2>&1' \
node bench/bench-pi-paired.js
```

Results are written under `bench/results/` with one JSONL transcript per task/side and a `report.json` summary.

The default task pack lives at `bench/fixtures/pi-memory-tasks.json`. It intentionally mixes:

- `prior-decision`: memory should recover why something was chosen.
- `bug-history`: memory should recover the reason behind a fix.
- `staleness`: memory should warn/verify instead of blindly trusting old indexed facts.
- `navigation`: memory should jump to likely modules and then verify.
- `negative-control`: memory should not be necessary and should avoid adding overhead.

Each task has expected facts with aliases. The built-in grader is intentionally simple and deterministic; for publishable numbers, review misses manually or replace it with a stricter evaluator.

Use this benchmark as an internal regression and directional signal, not a comprehensive scientific evaluation. The harness is legitimate for comparing real memory-off and memory-on Pi runs because it records raw transcripts, structured reports, token usage, cache reads, elapsed time, tool counts, and expected-fact matches under `--no-session`. Its limits are that each side runs once, memory-off is vanilla Pi rather than a separately optimized retrieval baseline, memory-off always runs before memory-on by default, the grader is substring/alias based, and the task pack is intentionally small. For stronger external claims, add repeated runs, randomized side ordering, stricter/manual grading, and broader task coverage.

## Realworld Pi memory benchmark

`bench/realworld/bench-pi-realworld.js` runs Pi against real code-editing tasks — bugfixes, feature implementations, refactors, PR reviews — and measures whether memory-on improves completion rate, reduces wrong turns, and preserves project decisions better than memory-off.

Run:

```bash
npm run bench:pi-realworld
```

By default, the harness:
1. Creates a fresh git worktree for each run
2. Applies bug-injection patches to introduce failures
3. Runs Pi with the task prompt (memory-off first, then memory-on)
4. Grades results on three axes: tests pass, diff touches correct files, answer contains expected facts
5. Repeats each task 3 times for statistical signal

Options:

```bash
# More repetitions
node bench/realworld/bench-pi-realworld.js --runs 5

# Single task for debugging
node bench/realworld/bench-pi-realworld.js --only bugfix-createdb-config

# Keep worktrees for inspection
node bench/realworld/bench-pi-realworld.js --no-cleanup

# Custom timeout
node bench/realworld/bench-pi-realworld.js --timeout-ms 300000
```

Results are written under `bench/realworld/results/` with JSONL transcripts and a `report.json` summary.

The task pack lives in `bench/realworld/tasks/` with 8 tasks:
- 2 bugfix tasks (createDb config isolation, search ranking)
- 2 feature tasks (context hook limit, session summary hook)
- 1 refactor task (FTS5 rank scoring weights)
- 1 stale-index task (verify code index accuracy)
- 1 PR review task (evaluate trust-sync change)
- 1 negative-control task (README lookup)

Each task has:
- A `setup.checkout` pointing to a known-good commit
- Optional `setup.apply_patch` to inject a bug
- Optional `setup.seed_memory` to pre-populate LaPis with relevant memories
- `success.tests` — test commands that must pass after Pi edits
- `success.must_touch` / `success.must_not_touch` — file constraints
- `success.expected_facts` — answer content expectations

The report shows a comparison table:

```
╔════════════════════════╤════════════╤═══════════╗
║ Metric                 │ Memory Off │ Memory On ║
╟────────────────────────┼────────────┼───────────╢
║ Tasks solved           │       3/6  │      5/6  ║
║ Tests passed           │       2/6  │      5/6  ║
║ Median active tokens   │     18,400 │     7,900 ║
║ Median wall time       │     4m 20s │    2m 10s ║
║ Median tool calls      │         14 │         8 ║
║ Wrong-file edits       │          3 │         1 ║
╚════════════════════════╧════════════╧═══════════╝
```

This complements the paired benchmark. The paired benchmark tests knowledge retrieval; this benchmark tests code editing and problem-solving.
