# 支付接入清单（Waffo Pancake / 国内通道）

> 状态：**代码已就绪，生产未配置**。线上容器没有任何 `WAFFO_*` 环境变量，
> 登录用户点购买会拿到 503 `BILLING_NOT_CONFIGURED`，webhook 因缺 store 边界
> 全部 fail-closed。本文是「把它真正接上」的材料清单与验收步骤。
>
> 生成时间：2026-11-14。核对方式：`node scripts/billing-selftest.mjs`。

## 0. 现有底座（不用重做）

| 组件 | 位置 | 说明 |
|---|---|---|
| 发起收银台 | `POST /api/v1/billing/checkout` | `ACTIVE_CHECKOUT_PROVIDER = 'waffo'`，Creem 保留回切 |
| 回调验签 | `POST /api/webhooks/waffo` | RSA 验签 + `mode` 环境门 + `storeId` 租户门（fail-closed） |
| 入账 | `handleWaffoWebhook` → `creditService.applyDelta` | 幂等靠 `external_event_id` 部分唯一索引 |
| 商品 | `config/pricing.ts` `ADDON_PACKS` | pack-1 $3/20 张、pack-4 $10/80 张、pack-10 $20/200 张 |
| 读侧 | `/api/v1/user/billing` | 余额 / 购买史（由 PURCHASE 行 meta 重建） |

## 1. Waffo 开户材料（需企业主体）

1. 营业执照（在业、经营范围含技术服务/软件开发均可）
2. 法人身份证正反面 + 手持照（部分风控要）
3. 企业对公结算账户（开户许可证或银行信息截图）
4. 站点与业务说明：`https://outman.press`、商品与定价、退款政策页
5. 管理员邮箱/手机号（收商户后台验证码与结算通知）
6. 可选：ICP 备案信息（境内域名展示支付入口时通常会被要）

开通后拿到的三样东西 → 见下表 env。

## 2. 环境变量矩阵（配在 `deploy/china/.env`，然后重建容器）

| 变量 | 来源 | 必填 | 说明 |
|---|---|---|---|
| `WAFFO_MERCHANT_ID` | 商户后台 | ✅ | 缺失时 checkout 直接 503 |
| `WAFFO_STORE_ID` | 商户后台 | ✅ | **webhook 租户边界**；缺失时所有回调被拒（fail-closed） |
| `WAFFO_PRIVATE_KEY` | 商户后台（API 私钥，通常为 PEM/单行 base64） | ✅ | 发起 checkout 用 |
| `WAFFO_ENV` | 自选 | ✅ | `test` / `prod`。验签公钥与拒收环境都跟着它走；上线前先在 `test` 跑通 |
| `WAFFO_PRODUCT_ID_PACK_1` | 商户后台创建商品 | ✅ | $3 / 20 张 |
| `WAFFO_PRODUCT_ID_PACK_4` | 同上 | ✅ | $10 / 80 张 |
| `WAFFO_PRODUCT_ID_PACK_10` | 同上 | ✅ | $20 / 200 张 |

注意事项：
- 三个 Product ID 必须与 `ADDON_PACKS` 的 books 数一致（20/80/200），
  否则用户付款拿到的积分与页面不符 —— 这是钱货不符，不只是 UI 问题。
- `WAFFO_ENV=test` 时回调验签用的是测试环境公钥，**生产配置错成 test 会把真钱回调全部拒掉**；
  反之测试配置成 prod 同理。上线前必须确认这一项。

## 3. 联调验收（每一步都要过）

1. **配置自检**：`node scripts/billing-selftest.mjs`（本地或服务器跑）——
   逐项检查 env 是否齐全、线上路由是否活着。
2. **收银台唤起**：登录态下点首页 #pricing 任一档 → 应跳到 Waffo 托管页，
   金额/商品名/币种与定价页一致。
3. **支付成功回调**：测试环境用测试卡完成一笔 → 查 `credit_ledger` 出现
   `PURCHASE` 行、`balance_after` 正确、`meta.external_event_id` 落库。
4. **回调重放**：在商户后台重发同一事件 → 余额不变、不出现第二笔 PURCHASE
   （幂等靠唯一索引）。
5. **失败/取消路径**：托管页取消支付 → 无 PURCHASE 行、余额不变。
6. **退款**（如开通）：后台发起退款 → `REFUND` 行落账、余额回退，事件可对账。
7. **`WAFFO_ENV` 切 prod** 后重跑 2–4（至少一笔真实小额）。

## 4. 国内通道（微信/支付宝）额外清单

若后续要接人民币直连/聚合：

- **资质**：企业主体是硬门槛（个人无法开通微信/支付宝商户）；需要 ICP 备案（境内支付入口）。
- **通道形态二选一**：
  - 直连（微信支付 APIv3 / 支付宝开放平台）：需各自商户号、API 证书/密钥、
    回调地址备案；开发量 ≈ 新增一个 `wechat-pay-service` + webhook 验签 + 对账。
  - 聚合服务商：一家对接多通道，开户快，费率略高；需要评估其资质与资金安全。
- **代码改动面**：`ACTIVE_CHECKOUT_PROVIDER` 增加枚举、`ADDON_PACKS` 增 `priceCny`、
  checkout 路由按币种分流、webhook 新增验签与入账（复用 `applyDelta` + 幂等索引）。
- **对账**：人民币通道必须做日对账（下载账单 vs `credit_ledger` PURCHASE 行），
  跨境卡通道的「事件即真相」在这里不够。

## 5. 已知缺口（接之前要先修）

| 缺口 | 影响 | 处理 |
|---|---|---|
| 生产无任何 `WAFFO_*` | 支付不可用 | 按第 2 节配置 |
| 未配置时购买按钮照常可点、点了报 503 | 用户看到红字错误 | 建议：`BILLING_NOT_CONFIGURED` 时按钮置灰/显示「即将开放」 |
| 定价只有 USD | 国内用户需换汇 | 视币种决策再定 |
| 退款自助入口 | 用户需邮件申请 | 已补 `/refund` 退款政策页（五语种，页脚可直达）；自助申请表单可后置 |
