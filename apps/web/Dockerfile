# FlowBoard web — multi-stage image. BUILD CONTEXT IS THE REPO ROOT:
#
#   docker build -f apps/web/Dockerfile -t flowboard-web .
#
# The build stage compiles the Vite SPA (and the workspace packages it imports);
# the runtime stage is nginx serving the static bundle and proxying /api +
# /socket.io to the `api` service, so the browser only ever sees one origin.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm 11 verifies that installed deps match the manifest before running a
# script; in a layered image the check re-walks the store on every RUN for no
# benefit, since the lockfile install already guaranteed it.
ENV npm_config_verify_deps_before_run=false
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install the FULL workspace, cached on the manifests alone.
#
# Not `--filter=@flowboard/web...`: that omits the devDependencies of
# dependency-only workspace packages, and `@flowboard/shared` needs its own
# devDep `tsup` to build the `.d.ts` files the web typecheck resolves against.
# A full install guarantees every build-time devDep is present; the runtime
# stage is plain nginx, so nothing needs pruning afterwards.
#
# `--ignore-scripts` avoids pnpm's interactive build-approval gate (the one
# script this repo does allow, esbuild's, is declared in pnpm-workspace.yaml
# and is not needed to produce the static bundle here).
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY e2e/package.json ./e2e/
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# build: compile the shared contracts, then the bundle.
#
# VITE_* values are INLINED into the static output at build time, so they are
# build args rather than runtime env. VITE_API_URL defaults to empty, which
# means same-origin — the nginx config below is what makes that work.
FROM deps AS build
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
COPY packages/config ./packages/config
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter=@flowboard/shared build \
  && pnpm --filter=@flowboard/web build

# ---------------------------------------------------------------------------
# runtime: nginx serving the static SPA.
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
