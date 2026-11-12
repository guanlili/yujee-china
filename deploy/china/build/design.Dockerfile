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
# 2026-11-10：npmmirror 对单包 tgz 的下载会偶发 Socket timeout（同一条构建里
# 每次卡在不同包：pump-3.0.4、shebang-regex-1.0.0……），整条部署因此失败且与
# 代码无关。默认 fetch 重试只有 2 次、超时偏短，这里放宽并把整条 install 再兜
# 一次;第二次兜底同时换回官方 registry —— 镜像源单点抽风时换源比继续重试有效。
ARG PNPM_FETCH="--fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=180000 --fetch-timeout=180000"
RUN pnpm install --filter @smalldog/design-agent... --frozen-lockfile $PNPM_FETCH \
 || pnpm install --filter @smalldog/design-agent... --frozen-lockfile $PNPM_FETCH --registry=https://registry.npmjs.org
COPY . .
# COPY . . 会带入上下文里的 packages/*/node_modules 与 dist(宿主残留),
# 覆盖掉上一步的依赖并打断 symlink,表现为构建 pi-ai 时报
# `Cannot find module '@anthropic-ai/sdk'`。再按 lockfile 复装一次。
RUN pnpm install --filter @smalldog/design-agent... --frozen-lockfile $PNPM_FETCH \
 || pnpm install --filter @smalldog/design-agent... --frozen-lockfile $PNPM_FETCH --registry=https://registry.npmjs.org
RUN pnpm --filter @earendil-works/pi-ai build \
 && pnpm --filter @earendil-works/pi-agent-core build

EXPOSE 8787
CMD ["sh", "-c", "pnpm -C packages/design-agent exec tsx src/web/album-server.ts --host 0.0.0.0 --port ${PORT}"]
