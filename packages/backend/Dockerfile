FROM node:22-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/backend/ ./packages/backend/

RUN pnpm -r run build

EXPOSE 3000

CMD ["node", "packages/backend/dist/server.js"]
