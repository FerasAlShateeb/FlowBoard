# syntax=docker/dockerfile:1
#
# @flowboard/api — multi-stage production image.
#
# BUILD CONTEXT IS THE REPO ROOT, not this directory:
#   docker build -f apps/api/Dockerfile -t flowboard-api .
# (docker-compose.yml sets `context: .` + `dockerfile: apps/api/Dockerfile`.)
# The API depends on the `@flowboard/shared` workspace package, so the build
# needs the lockfile, the workspace manifest and that package's source — none of
# which exist inside apps/api.
#
# Stages:
#   deps      — lockfile-only `pnpm fetch`, so the (slow) download layer is
#               cached until pnpm-lock.yaml itself changes, not on every edit.
#   build     — offline install of the full workspace, then shared → api builds.
#   prod-deps — offline PROD-only install (no tsup, no typescript, no vitest).
#   release   — a CLEAN base with the prod `node_modules` and the two `dist/`
#               folders copied in. Runs as `node`.
#
# `release` starts from `base` rather than extending `deps` on purpose. `pnpm
# fetch` warms the content-addressable store at /pnpm/store with EVERY package
# in the lockfile — including Vite, Playwright and the rest of the web
# toolchain. Those bytes live in the `deps` layer, and a layer's contents cannot
# be deleted by a later `rm`: they can only be left behind by not inheriting
# from it. Copying /app out of a throwaway install stage does exactly that, and
# it is worth roughly 600 MB of image.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# `pnpm fetch` leaves a node_modules skeleton behind, and the later `--prod`
# install wants to purge it — which it refuses to do without a TTY unless it
# knows it is running unattended.
ENV CI=true
RUN corepack enable
WORKDIR /app

# ── deps: warm the pnpm content-addressable store from the lockfile ──────────
FROM base AS deps
# `.npmrc` carries node-linker=hoisted — it must be present for every install.
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
# Workspace manifests only: an edit to a source file must not invalidate this.
# ALL of them, including the ones this image does not build: `--frozen-lockfile`
# compares the lockfile's importers against the projects it can actually find,
# and a missing workspace member reads as a lockfile that is out of date.
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY e2e/package.json ./e2e/

# ── build: full install + compile shared, then api ──────────────────────────
FROM deps AS build
# `...` = the package plus everything it depends on (config + shared); apps/web
# and e2e are declared members but never installed here.
RUN pnpm install --frozen-lockfile --offline --filter @flowboard/api...
# Source only. The repo-root `.dockerignore` now excludes `node_modules/`,
# `dist/` and `.turbo/`, so a whole-directory copy would also be safe — the
# explicit list is kept because it is TIGHTER: an edit to a test file or a
# README in these packages leaves this layer cached.
COPY packages/config/*.json packages/config/*.mjs ./packages/config/
COPY packages/shared/tsconfig.json packages/shared/tsup.config.ts ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
# Order matters: apps/api typechecks against packages/shared's emitted .d.ts.
RUN pnpm --filter @flowboard/shared build \
  && pnpm --filter @flowboard/api build

# ── prod-deps: the runtime dependency tree, nothing else ────────────────────
# Throwaway stage. Its /app is what ships; its /pnpm store is what does not.
#
# The `rm -rf` is load-bearing, not tidiness. `pnpm fetch` leaves a node_modules
# SKELETON behind — a `.pnpm` virtual store holding every package in the
# lockfile, the web toolchain included — and a `--prod --filter` install on top
# of it prunes the links without pruning what they pointed at. Measured: turbo
# (43 MB), lucide-react (36 MB), typescript (23 MB), playwright-core and three
# copies of esbuild all shipped in the API image. Deleting the skeleton first
# and reinstalling from the (still warm, still offline) store costs a few
# seconds and takes the image from 554 MB to 200 MB.
FROM deps AS prod-deps
ENV NODE_ENV=production
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules e2e/node_modules \
  && pnpm install --frozen-lockfile --offline --prod --filter @flowboard/api...

# ── release: production dependencies + compiled output only ─────────────────
FROM base AS release
ENV NODE_ENV=production
# The whole workspace skeleton: hoisted node_modules, the `.npmrc` that made it
# hoisted, and every package.json. The manifests are not optional — Node reads
# `packages/shared/package.json` to resolve the `@flowboard/shared` symlink that
# sits in the root node_modules.
COPY --from=prod-deps /app /app
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
# The generated SQL, resolved by `dist/scripts/migrate.js` as `../../drizzle`.
# Without it the image can run the app but cannot provision the database it
# needs — and the failure is a confusing "no migrations found", not an error.
COPY apps/api/drizzle ./apps/api/drizzle

# Drop privileges. `node` (uid 1000) ships with the base image. No `chown -R`:
# the tree is root-owned but world-readable, and the process writes nothing to
# disk (logs go to stdout, attachments to S3) — recursively re-owning a
# node_modules tree costs ~90 s and a duplicate image layer for no benefit.
USER node

ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api

# The default command SERVES. It never migrates and never seeds: a container
# that mutates the schema on boot turns a restart loop or a scaled-out replica
# into concurrent DDL. The maintenance entry points are the same image with a
# different command, which is how docker-compose.yml's `migrate` service and
# the documented seed one-shot both work:
#
#   node dist/scripts/migrate.js   # idempotent; applies pending migrations
#   node dist/scripts/seed.js      # demo data — never in a real deployment
#   node dist/scripts/reset.js     # DROPS every table
#
# There is no `tsx` in this image, which is why these are the compiled `.js`
# under dist/ rather than the `pnpm db:*` scripts used in development.
CMD ["node", "dist/server.js"]
