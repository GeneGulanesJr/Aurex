# GitHub Repo Prepare Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmation + prepare flow before selecting a GitHub repo for a mission.

**Architecture:** Extract existing repo clone/fetch logic into `repo-prep.ts`; add `POST /api/github/repos/prepare`; frontend shows a `RepoPrepareModal` and only marks repo ready after backend preparation succeeds.

**Tech Stack:** Fastify backend, React frontend, existing LaPis settings API, Vitest tests.

---

### Task 1: Backend repo prep helper

**Files:**
- Create: `packages/backend/src/orchestrator/repo-prep.ts`
- Modify: `packages/backend/src/orchestrator/mission-runner.ts`

- [ ] Create helper with `repoDirNameFromCloneUrl`, GitHub URL validation, token injection, idempotent clone/fetch.
- [ ] Replace private `prepareMissionRepo` in mission runner with helper import.
- [ ] Run backend tests.
- [ ] Commit.

### Task 2: GitHub prepare route

**Files:**
- Modify: `packages/backend/src/routes/github.ts`
- Modify: `packages/backend/src/server.ts`
- Test: `packages/backend/__tests__/routes/github.test.ts`

- [ ] Add `repoRoot` to `GitHubRouteDeps`.
- [ ] Add `POST /api/github/repos/prepare`.
- [ ] Validate `github_token` exists.
- [ ] Validate cloneUrl is in `listRepos(token)`.
- [ ] Call `prepareRepoForMission`.
- [ ] Return `{ fullName, repoPath, repoStatus, indexed: false, indexingStatus: "unavailable" }`.
- [ ] Update tests.
- [ ] Commit.

### Task 3: Frontend API + form state

**Files:**
- Modify: `packages/frontend/src/api.ts`
- Modify: `packages/frontend/src/active/useNewMissionForm.ts`

- [ ] Add `prepareGitHubRepo` API function.
- [ ] Add `selectedRepoFullName` to form state.
- [ ] Update `setRepo(cloneUrl, repoId, fullName)`.
- [ ] Commit.

### Task 4: RepoPrepareModal + NewMissionForm wiring

**Files:**
- Create: `packages/frontend/src/active/RepoPrepareModal.tsx`
- Modify: `packages/frontend/src/active/NewMissionForm.tsx`

- [ ] Add modal with Use This Repo / Cancel.
- [ ] On repo select, open modal instead of selecting immediately.
- [ ] On confirm, call prepare API, then set repo ready.
- [ ] Show `REPO READY · owner/repo`.
- [ ] Run typecheck/tests.
- [ ] Commit.

### Task 5: Final verification + Docker rebuild

- [ ] Run `npx vitest run`.
- [ ] Run frontend TS compile.
- [ ] Rebuild/restart Docker backend+frontend.
- [ ] Commit any fixes.
