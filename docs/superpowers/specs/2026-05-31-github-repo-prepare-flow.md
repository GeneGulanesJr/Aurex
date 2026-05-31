# GitHub Repo Prepare Flow

**Goal:** When a user selects a GitHub repository for a mission, Aurex should ask for explicit consent, then clone/fetch the repo into the Docker workspace and prepare it for LaPis indexing before the mission is created.

**Why:** Selecting a repo has side effects: Aurex will clone code into the workspace and agents will use it as mission context. The UI should make that explicit and avoid surprising the user.

---

## User Flow

1. User opens **New Mission**.
2. User chooses a repository from `RepoPicker`.
3. Aurex opens a confirmation modal.
4. Modal explains what Aurex will do:
   - Clone or update the repository in the Docker workspace
   - Index the code with LaPis when repo indexing is available
   - Use it as the working repository for this mission
5. User clicks **Use This Repo**.
6. UI shows progress: `Preparing repository...`.
7. Backend clones or fetches the repository.
8. Backend attempts LaPis indexing if an indexing endpoint is available.
9. Repo becomes selected only after successful clone/fetch.
10. User writes the mission prompt and clicks **Create**.

---

## Modal Copy

```txt
Use this repository?

Aurex will prepare this repository before starting your mission.

• Clone or update the repository in the Docker workspace
• Prepare the repo for LaPis indexing when the endpoint is available
• Use it as the working repo for this mission

GeneGulanesJr/example-repo
Default branch: main

[Cancel] [Use This Repo]
```

Button text: **Use This Repo**.

---

## Backend Route

Update GitHub route dependencies so the route can access the Docker workspace root:

```ts
registerGitHubRoutes(app, { lapis, repoRoot: config.repoRoot });
```

`GitHubRouteDeps` becomes:

```ts
interface GitHubRouteDeps {
  lapis: LaPisClient;
  repoRoot: string;
}
```

Add:

```txt
POST /api/github/repos/prepare
```

Payload:

```json
{
  "cloneUrl": "https://github.com/owner/repo.git"
}
```

Response:

```json
{
  "repoPath": "/workspace/repos/owner-repo",
  "repoStatus": "cloned",
  "indexed": false,
  "indexingStatus": "unavailable"
}
```

`indexed` is `false` for now because the current Docker LaPis HTTP server does not expose a repo indexing endpoint. The route should still return clone/fetch success and explicitly report indexing as unavailable.

When LaPis later exposes repo indexing over HTTP, this route can call it and return:

```json
{
  "repoPath": "/workspace/repos/owner-repo",
  "repoStatus": "updated",
  "indexed": true,
  "indexingStatus": "completed"
}
```

---

## Repository Preparation Logic

Extract the existing clone/fetch behavior from `mission-runner.ts` into a shared backend helper:

```txt
packages/backend/src/orchestrator/repo-prep.ts
```

Responsibilities:

- Derive safe local repo directory name from clone URL
- Create `/workspace/repos` if needed
- If repo already exists, run `git fetch --all --prune`
- If repo does not exist, clone it
- Use saved GitHub OAuth token when cloning GitHub HTTPS URLs
- Return local repo path and repo status (`cloned`, `updated`, or `existing`)
- Be idempotent: if the mission runner later prepares the same repo again, it only fetches updates instead of recloning

Both the new prepare route and the mission runner should use the same helper to avoid duplicate clone logic. It is expected that the mission runner may call this helper again when the mission starts. That is safe because the helper is idempotent: existing repos are fetched, not recloned.

---

## Frontend Changes

### New component

Create:

```txt
packages/frontend/src/active/RepoPrepareModal.tsx
```

Props:

```ts
interface RepoPrepareModalProps {
  repo: GitHubRepoResponse;
  preparing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}
```

### New API function

Add to `packages/frontend/src/api.ts`:

```ts
export async function prepareGitHubRepo(cloneUrl: string): Promise<{
  repoPath: string;
  repoStatus: "cloned" | "updated" | "existing";
  indexed: boolean;
  indexingStatus: "completed" | "unavailable" | "failed";
}>;
```

### NewMissionForm behavior

Current behavior:

```ts
RepoPicker onSelect -> setRepo(repo.clone_url, repo.id)
```

New behavior:

```ts
RepoPicker onSelect -> set pending repo -> open RepoPrepareModal
Use This Repo -> POST /api/github/repos/prepare -> setRepo(repo.clone_url, repo.id)
Cancel -> clear pending repo
```

`RepoPicker` itself stays simple. It only emits selected repo. `NewMissionForm` owns the confirmation/preparation flow.

---

## Error Handling

### Invalid clone URL

The backend must reject non-GitHub clone URLs. Accepted format:

```txt
https://github.com/<owner>/<repo>.git
```

Equivalent GitHub HTTPS URLs without the `.git` suffix may be normalized internally, but arbitrary hosts are rejected with `400`.

### GitHub not connected

The backend must check for the saved `github_token` before clone/fetch. If missing, return `401` with:

```json
{ "error": "GitHub is not connected" }
```

### Clone/fetch failure

Modal stays open and shows:

```txt
Could not prepare repository. Check GitHub permissions and try again.
```

### Indexing unavailable

This is not a blocking failure. The repo can still be selected after clone/fetch succeeds. The response reports `indexingStatus: "unavailable"` and the UI can show a muted note:

```txt
Repository prepared. LaPis indexing is not available in this Docker build yet.
```

### User cancels

No backend call is made. Repo is not selected.

---

## Testing Requirements

Add or update tests for:

1. Repo prep helper clones a new GitHub repository into `/workspace/repos/<owner>-<repo>`.
2. Repo prep helper fetches an existing repository instead of recloning.
3. Repo prep helper rejects non-GitHub clone URLs.
4. `POST /api/github/repos/prepare` rejects when GitHub is not connected.
5. `POST /api/github/repos/prepare` returns `repoStatus` and `indexingStatus` on success.
6. `NewMissionForm` opens `RepoPrepareModal` when a repo is selected.
7. `NewMissionForm` only calls `setRepo` after prepare succeeds.

---

## Acceptance Criteria

1. Selecting a repo opens a confirmation modal instead of immediately selecting it.
2. Modal uses **Use This Repo** as the confirm button.
3. Confirming calls `POST /api/github/repos/prepare`.
4. Backend clones new repos and fetches existing repos using the saved GitHub token.
5. Repo becomes selected only after successful backend preparation.
6. Clone/fetch errors appear in the modal.
7. Mission creation still receives the selected repo clone URL.
8. Mission runner uses the shared repo preparation helper instead of duplicate clone logic.
9. Route response explicitly reports repo status and indexing status.
10. Prepare route rejects invalid/non-GitHub clone URLs.
11. Prepare route rejects requests when GitHub is not connected.
12. Existing tests continue to pass.
