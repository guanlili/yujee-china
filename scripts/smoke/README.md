# 冒烟脚本

三个脚本,职责不同,别互相替代。

| 脚本 | 打哪里 | 会不会写数据 | 用途 |
|---|---|---|---|
| `prod-readonly.mjs` | 生产(默认 `https://outman.press`) | **不写**,只有 GET/HEAD 和必然被拒的负向请求 | 上线后回归:全站可达性、SEO 契约、鉴权跳转、支付 fail-closed |
| `local-flow.mjs` | 只允许 localhost | 会新建一次性测试账号与相册 | 本地/测试实例验证登录主流程(better-auth → 会话 → 相册 → 支付闸门 → 退出) |
| `pdf-export-e2e.mjs` | 只允许 localhost | 会注册账号、建相册、往对象存储写 PDF | 真浏览器点「导出 PDF」,验证栅格化 → 预签名直传 → 落库确认整条链路 |

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

## PDF 导出端到端(pdf-export-e2e.mjs)

这条链路(画板栅格化 → 生成 PDF blob → 浏览器直传对象存储 → `PUT /api/v1/albums/{uuid}/pdf` 落库)
在服务端单测里跑不到——渲染只发生在浏览器。这个脚本用 Playwright 真点一遍:

```bash
# 1. 一套本地环境:PG + dev 实例(env 指到本地 S3 兼容存储,如 S3_ENDPOINT=http://127.0.0.1:9000)
docker start yujee-test-pg
set -a; . /tmp/dev.env; set +a
pnpm --filter @yujee/web dev -p 3100

# 2. 一个假 S3(只认 PUT/GET/HEAD + CORS 预检),落盘到 /tmp/fake-s3-data
node scripts/smoke/fake-s3.mjs   # 见下方「假 S3 的要点」

# 3. 临时把该源加进 CSP connect-src(仅本地跑验证用,**不要提交**):
#    apps/web/src/middleware.ts: "connect-src 'self' https://*.myqcloud.com http://127.0.0.1:9000"

# 4. playwright(不进仓库依赖,装临时目录)
mkdir -p /tmp/e2e-pw && cd /tmp/e2e-pw && npm i playwright && npx playwright install chromium

# 5. 跑
cd <repo> && SMOKE_PLAYWRIGHT_DIR=/tmp/e2e-pw node scripts/smoke/pdf-export-e2e.mjs
```

断言 20 项:菜单三级点击、下载到真 PDF(`%PDF-` 头 + 体积)、`pdf-upload-url` 被调用、
预签名 PUT 200、`PUT /pdf` 200、`albums.pdf_r2_key` 落在 `pdfs/<albumId>/` 命名空间、
`status` 翻 COMPLETED、存储里对象与下载件字节一致;跑完删账号与相册。

### 假 S3 的要点

- 必须是 **path-style**(`/<bucket>/<key>`),并返回 CORS 头 + 处理 `OPTIONS` ——
  浏览器跨源 PUT 会先发预检,少了它就是 `net::ERR_FAILED`(真实 COS 桶也要配 CORS 规则)。
- CSP 的 `connect-src` 只写了 `https://*.myqcloud.com`。用它自己的子域走 https 也行,
  但**非默认端口不在 host-source 里**,所以本地跑一般直接临时加 `http://127.0.0.1:<port>`。

## CI

`smoke-prod.yml` 每天跑一次 `prod-readonly`,也可以手动 `workflow_dispatch` 触发。
它不出现在 PR 闸门里:生产状态与当次改动无关,PR 变红不该由线上抖动决定。
