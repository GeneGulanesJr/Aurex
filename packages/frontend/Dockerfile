FROM node:22-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/frontend/package.json ./packages/frontend/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/frontend/ ./packages/frontend/

RUN pnpm -r run build

FROM nginx:alpine

COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 80
