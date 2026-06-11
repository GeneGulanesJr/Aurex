FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ curl git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/backend/ ./packages/backend/

RUN pnpm -r run build

USER node

# Allow git operations on mounted repository directories owned by a
# different host UID (Docker volume mounts preserve host ownership).
# The backend runs git worktree, branch, and merge commands against
# ${REPO_ROOT}, so this must be configured for the running user.
RUN git config --global --add safe.directory '*'

EXPOSE 3000

CMD ["node", "packages/backend/dist/server.js"]
