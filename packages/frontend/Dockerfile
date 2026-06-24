FROM node:22-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/frontend/package.json ./packages/frontend/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/frontend/ ./packages/frontend/

ARG VITE_AUTH_DISABLED
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ENV VITE_AUTH_DISABLED=$VITE_AUTH_DISABLED \
    VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN \
    VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID \
    VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE

RUN pnpm -r run build

FROM nginx:alpine

RUN apk add --no-cache curl openssl

COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# --- TLS certificates -------------------------------------------------------
# The certs/ directory is gitignored (it holds environment-specific TLS
# material and must not be committed), so a fresh clone has no certs and a
# naive `COPY certs/` fails the build. To make `docker compose up --build`
# work out of the box, bake in a self-signed cert as the default. For real
# deployments, override by mounting production certs at runtime:
#
#   volumes:
#     - /path/to/prod/certs:/etc/nginx/certs:ro
#
# (A bind mount at the same path takes precedence over the image layer, so the
# baked-in self-signed cert is only used when nothing is mounted.)
RUN mkdir -p /etc/nginx/certs && \
    openssl req -x509 -nodes -newkey rsa:2048 \
      -days 825 \
      -keyout /etc/nginx/certs/key.pem \
      -out /etc/nginx/certs/cert.pem \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" && \
    chown -R nginx:nginx /etc/nginx/certs/ && \
    chmod 644 /etc/nginx/certs/cert.pem && \
    chmod 640 /etc/nginx/certs/key.pem

# Run nginx as non-root
RUN mkdir -p /var/cache/nginx /run && \
    chown -R nginx:nginx /var/cache/nginx /run && \
    chown -R nginx:nginx /var/log/nginx

USER nginx

EXPOSE 80 443
