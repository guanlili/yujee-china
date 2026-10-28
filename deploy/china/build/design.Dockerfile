# design-agent 国内构建变体（上游 packages/design-agent/Dockerfile + npmmirror 一处差异）。
# 上游改动（install 过滤、pi 包构建、CMD）时应同步回灌本文件。
# 构建上下文 = 仓根等价目录树（由 design.Dockerfile.dockerignore 裁剪）。
FROM node:24-slim

RUN corepack enable
WORKDIR /app
ENV PORT=8787
# 国内 npm 源（唯一与上游的差异）。
ENV npm_config_registry=https://registry.npmmirror.com

# 依赖层只用清单文件(2026-10-29 分层修复,理由同 web.Dockerfile);design
# 上下文含 packages 全量,manifest 拷全部 workspace 包(pnpm 图校验需要)。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.pi.base.json ./
COPY packages/agent/package.json ./packages/agent/
COPY packages/ai/package.json ./packages/ai/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/design-agent/package.json ./packages/design-agent/

# 与上游一致：只装 design-agent 子树（含 workspace 依赖与 devDeps——tsx 运行、
# tsgo 构建 pi 包），随后构建两个 pi 包到 dist/。
RUN pnpm install --filter @smalldog/design-agent... --frozen-lockfile
COPY . .
RUN pnpm --filter @earendil-works/pi-ai build \
 && pnpm --filter @earendil-works/pi-agent-core build

EXPOSE 8787
CMD ["sh", "-c", "pnpm -C packages/design-agent exec tsx src/web/album-server.ts --host 0.0.0.0 --port ${PORT}"]
