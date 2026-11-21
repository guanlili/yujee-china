# 冒烟脚本

两个脚本,职责不同,别互相替代。

| 脚本 | 打哪里 | 会不会写数据 | 用途 |
|---|---|---|---|
| `prod-readonly.mjs` | 生产(默认 `https://outman.press`) | **不写**,只有 GET/HEAD 和必然被拒的负向请求 | 上线后回归:全站可达性、SEO 契约、鉴权跳转、支付 fail-closed |
| `local-flow.mjs` | 只允许 localhost | 会新建一次性测试账号与相册 | 本地/测试实例验证登录主流程(better-auth → 会话 → 相册 → 支付闸门 → 退出) |

```bash
pnpm smoke:prod                              # 162 项只读检查
SMOKE_BASE_URL=http://localhost:8080 pnpm smoke:prod

# 本地流程(需要本地 PG + dev 实例,见 apps/web/README)
docker start yujee-test-pg
set -a; . /tmp/dev.env; set +a
pnpm --filter @yujee/web dev -p 3100         # 另开终端
pnpm smoke:local
```

## 为什么 local-flow 会硬拒绝非 localhost

它会注册账号、建相册、改 `email_verified`。指到生产就是往真实库里塞测试数据 ——
`BASE` 不是 `http://localhost` / `http://127.0.0.1` 时脚本直接退出码 2。

## CI

`smoke-prod.yml` 每天跑一次 `prod-readonly`,也可以手动 `workflow_dispatch` 触发。
它不出现在 PR 闸门里:生产状态与当次改动无关,PR 变红不该由线上抖动决定。
