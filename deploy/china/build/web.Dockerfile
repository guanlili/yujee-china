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
COPY . .
RUN pnpm install --filter @yujee/web... --frozen-lockfile
RUN pnpm --filter @yujee/web build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@yujee/web", "start"]
