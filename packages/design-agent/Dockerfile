# Album Design Agent (@smalldog/design-agent) — the design-agent container.
#
# Runs the album-server via tsx directly on source (no compile step for this
# package). Its workspace deps (@earendil-works/pi-ai, pi-agent-core) resolve to
# their dist/ via package exports, so those two ARE built here. Templates are
# read from disk (packages/contracts/templates) exactly like
# the Python engine, so those dirs must be present in the image.
#
# Build from repo ROOT so the monorepo (pnpm workspace) is the build context.
FROM node:24-slim

# corepack pins pnpm to the version in root package.json (packageManager field).
RUN corepack enable
WORKDIR /app
ENV PORT=8787

# Whole repo (see /.dockerignore for exclusions: node_modules, build artifacts,
# apps/web, engine — none needed at runtime).
COPY . .

# Install the design-agent subtree only (its workspace deps + their devDeps —
# tsx to run album-server, tsgo to build the pi packages). NODE_ENV is left unset
# during install so devDependencies are included; it is set to production only at
# runtime via the container environment.
RUN pnpm install --filter @smalldog/design-agent... --frozen-lockfile \
 && pnpm --filter @earendil-works/pi-ai build \
 && pnpm --filter @earendil-works/pi-agent-core build

EXPOSE 8787

# Listen on all interfaces on $PORT. Config/secrets come from the environment
# (compose env_file on the server), not a .env.local file, in production.
CMD ["sh", "-c", "pnpm -C packages/design-agent exec tsx src/web/album-server.ts --host 0.0.0.0 --port ${PORT}"]
