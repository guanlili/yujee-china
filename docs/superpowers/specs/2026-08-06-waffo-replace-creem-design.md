# Waffo Pancake 替换 Creem 设计（Phase 1）

日期：2026-08-06 ｜ 状态：已获用户批准 ｜ 分支：feat/waffo-payments

## 背景与决策

- Creem 提现体验差（窗口制+额度限制），用户决定整体切换到 Waffo Pancake（杭州 MoR，2026-01 Illuminate Financial $30M A 轮，`@waffo/pancake-ts` SDK）。
- **执行顺序（已确认）**：先切 Waffo 止血 → Creem 余额停止增长 → 用户提干净 Creem 后，Phase 2 另开 PR 删除全部 Creem 代码（照 stripe-removal 先例）。
- **已确认的取舍**：买家侧支付方式从 卡+Apple Pay+Google Pay+PayPal（Creem）收窄为 卡+Apple Pay+Google Pay（Waffo 无 PayPal/微信/支付宝）。用户知情并接受。
- 本仓当前生产链路参考：`apps/web/src/services/billing/creem-service.ts`（新代码对齐其接口形状）。

## 范围

**做**：waffo-service + webhook 端点 + provider 切换 + env + 枚举迁移 + 测试 + 文档 checked-at。
**不做**（Phase 1）：删除 Creem 代码（webhook/env 留作在途订单兜底）、订阅类产品（只有 onetime 积分包）、购买 UI 改动、汇率/多币种（维持 USD）。

## 组件设计

1. **依赖**：`@waffo/pancake-ts` 锁定精确版本（保存时点最新 0.17.0）。安装前审包：`npm pack` 解包检查 install 脚本与可疑网络调用。
2. **`apps/web/src/services/billing/waffo-service.ts`**
   - `createPackCheckout({userId, email, packId, locale, from})`：校验 `ADDON_PACKS` → `client.checkout.createSession({productId: resolveWaffoProductId(packId), productType:'onetime', currency:'USD', buyerEmail, successUrl, metadata:{userId, kind:'pack', packId}})` → 返回 `checkoutUrl`。
   - `handleWebhook(rawBody, signature)`：包级 `verifyWebhook(body, sig)` 验签（header `x-waffo-signature`）→ **校验 `event.mode` 与 `WAFFO_ENV` 一致（生产拒收 test 事件）** → 只处理 `order.completed` → 幂等键 `waffo:{eventId}` 查 `credit_ledger.meta->>'external_event_id'` → 事务内 upsert `customers`(provider='waffo') + `creditService.applyDelta(+pack.books,'PURCHASE')`。
   - 错误码复用：`BILLING_NOT_CONFIGURED` / `WEBHOOK_SIGNATURE_INVALID` / `WEBHOOK_NOT_CONFIGURED` / `BILLING_UPSTREAM_ERROR`。
3. **路由**：`/api/v1/billing/checkout` 按 `ACTIVE_CHECKOUT_PROVIDER` 分发（改 `pricing.ts` 为 `'waffo'`）；新增 `/api/webhooks/waffo/route.ts`（`runtime='nodejs'`，raw text）。三个购买入口零改动；success_url 走 `buildCheckoutReturnUrls` 带 `provider=waffo`。
4. **`pricing.ts`**：`CHECKOUT_PROVIDERS` 加 `'waffo'`；`WAFFO_PRODUCT_ENV_BY_PACK_ID` 映射 `WAFFO_PRODUCT_ID_PACK_1/_4/_10`。
5. **env（`lib/env.ts` + `.env.example`）**：`WAFFO_MERCHANT_ID / WAFFO_STORE_ID / WAFFO_PRIVATE_KEY / WAFFO_ENV('test'|'live') / WAFFO_PRODUCT_ID_PACK_1/_4/_10`，全部 optional（存在即开关惯例），不进 `PRODUCTION_REQUIRED`。私钥仅存 env，禁止入库/入日志。
6. **DB**：迁移 0025 `ALTER TYPE`（customers.provider 枚举）加 `'waffo'`。无其他 schema 改动。
7. **admin**：`admin/settings/page.tsx` providers 列表加 `{name:'Waffo', on: Boolean(env.WAFFO_MERCHANT_ID)}`。

## 数据流

购买入口 → POST `/api/v1/billing/checkout` → waffo-service 建 session → 整页跳 `checkoutUrl` → 付款 → Waffo POST `/api/webhooks/waffo` → 验签+mode 校验+幂等 → 事务发积分 → 前端回跳轮询余额（现有逻辑，零改动）。

## 开放技术问题（实现期用 SDK 类型定案）

- **webhook payload 是否回传 `metadata`**：官方文档 payload 示例只有 `{orderId, buyerEmail, currency, amount, taxAmount, productName}`，未见 metadata。装包后读 `node_modules/@waffo/pancake-ts` 的 TS 类型确认；若不回传 → 用 `client.orders.get(orderId)`（或等价 API）反查订单 metadata；再不通 → 以 productId→packId 映射 + buyerEmail→userId 兜底（须评估买家改邮箱的错配风险并在测试覆盖）。
- **`verifyWebhook` 的密钥来源**（示例未传 key：环境变量？dashboard webhook secret？）——同样以 SDK 类型/源码为准。

## 测试

`waffo-service.test.ts`（node:test + tsx，对照 creem 测试全集）：createSession 参数与 product id 解析、临时 RSA 密钥验签通过/失败/缺 header、`order.completed` 落账、幂等重放拒绝、mode 错配拒绝、非 completed 事件忽略、env 缺失 → `BILLING_NOT_CONFIGURED`。`handle-waffo-webhook.test.ts` 挂载点测试。现有 creem/stripe-removal/pricing 测试保持全绿。跑法：`pnpm --filter @yujee/web test`。

## 验证与上线清单

- 本地 worktree 起三服务（web:3000/agent:8001/design-agent:8787），用户把 test 私钥放 `apps/web/.env.local`（不经对话传递），测试卡 `4576750000000110` 走通 购买→webhook→积分到账。
- 评审（review engineer）修完所有问题 → 提交 → PR，不直接推 main。
- 用户侧上线动作：Waffo 正式商户开通、建 3 个积分包产品（$3/20、$10/80、$20/200，taxCategory=saas 或 digital_goods 以 Waffo 后台分类为准）并 publish、live 私钥等 env 配 Vercel、dashboard 配 webhook URL。
- doc-scope：改动命中 `apps/web/README.md`、根 `README.md`、`CLAUDE.md`，同步内容并推进 checked-at。

## Phase 2（另开 PR，等用户号令）

删除 creem-service、两个 webhook 路由、handle-creem-webhook、`CREEM_*` env 与 `.env.example` 段落、pricing 中 creem 映射；写 `creem-removal.test.ts` 断言以上不复存在；`customers` 的 creem 历史行与 `credit_ledger` 记录保留；`customers.provider` 枚举值 `'creem'` 保留（历史数据引用）。
