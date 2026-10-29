# web (Next.js) 国内镜像 —— P2.3 草稿，本次首次实测构建。
# 构建上下文 = 仓根等价目录树：
#   docker build -f deploy/china/build/web.Dockerfile -t yujee/web:china .
# 待办（不阻塞跑通）：
#   - next.config 加 output:'standalone' 后切 .next/standalone（镜像可减半）；
#   - 数据库迁移不在此镜像流程内：部署流水线独立跑 db:migrate（多实例禁止并发迁移）。

FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# ---- builder ----
FROM base AS builder
# 国内 npm 源（corepack/pnpm 均认这个 env）。
ENV npm_config_registry=https://registry.npmmirror.com
# next build 期间 NODE_ENV=production 触发 assertProductionEnv（七件套缺一即炸）。
# 构建期只需"存在"，运行期用 compose 注入真实值。
ENV DATABASE_URL=postgres://build:build@build:5432/build \
    WEB_BASE_URL=http://build.placeholder \
    BETTER_AUTH_SECRET=build_placeholder \
    AGENT_BASE_URL=http://build.placeholder \
    AGENT_SHARED_SECRET=build_placeholder \
    DESIGN_AGENT_BASE_URL=http://build.placeholder \
    DESIGN_AGENT_SHARED_SECRET=build_placeholder
# 依赖层只用清单文件:lockfile/根配置/workspace 各包 package.json 不变时,
# 下面的 install 命中缓存 —— 源码改动(乃至纯文档 PR)不再触发全量重装。
# (2026-10-29 修复:此前 COPY . . 在 install 之前,任何改动都重装,白烧 ~3min/次)
# 注意 web 上下文白名单只含 contracts + apps/web,manifest 就只拷这两个包。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.pi.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
RUN pnpm install --filter @yujee/web... --frozen-lockfile
COPY . .
RUN pnpm --filter @yujee/web build

# ---- runner(standalone,2026-10-30)----
# 镜像从 ~2.4GB 减到 ~650MB:只拷 standalone 产物 + public + static。
# 关键:standalone 的 node_modules 用 pnpm symlink(相对路径),必须保持
# 原始目录结构(standalone 根 = /app),否则 symlink 断裂 → MODULE_NOT_FOUND。
# server.js 在 standalone/apps/web/ 下,WORKDIR 切过去运行。
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000 HOSTNAME=0.0.0.0

WORKDIR /app

# 整体拷贝 standalone 产物(保持目录结构:node_modules 在根,apps/web 在子目录)
COPY --from=builder /app/apps/web/.next/standalone ./

# 静态资源(CSR/ISR)和 public 文件 standalone 不含,须显式补拷
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# contracts 模板/价格表(runtime 加载用)
COPY --from=builder /app/packages/contracts/templates ./packages/contracts/templates
COPY --from=builder /app/packages/contracts/pricing ./packages/contracts/pricing

# db:migrate(deploy 脚本在容器内跑 drizzle-kit,standalone 不含 devDeps,
# 把 drizzle-kit 移到了 production deps;还需 migrations 目录 + 配置)
COPY --from=builder /app/apps/web/src/db/migrations ./apps/web/src/db/migrations
COPY --from=builder /app/apps/web/drizzle.config.ts ./apps/web/

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node", "server.js"]
