# 匿名免登录排版(游客模式)设计

日期:2026-08-04
分支:feat/anon-guest-flow

## 目标

登录墙从「落地页点发送」后移:匿名用户不登录即可走完 发送 → CLIP 分组 → 讲故事 →
选版 → 挑封面/底色 → 画板看成书 → 添加照片 → 导出 全流程。只有三件事要求登录:

1. 在 Agent 对话框里打字(design-chat)
2. 保存(照片云快照)
3. 分享

移动端与 Web 端统一同一套逻辑(闸门都在 API 层)。

## 核心决策(与用户确认过)

| 决策点 | 结论 |
|---|---|
| 匿名身份 | better-auth **anonymous 插件**(影子账号,`isAnonymous` 标记),登录时 `onLinkAccount` 过户 |
| AI 成稿 | 匿名**不跑 Gemini**。确认封面后由 Web 端确定性「占位文案填充器」填示例文案,状态照常推到 ready |
| 导出 | 匿名可导出:纯浏览器生成 PDF 本地下载,**不写 R2、不写 DB**,不加水印(封底自带品牌名) |
| 积分 | 匿名账号**不送** 20 积分;绑定为真实账号时补发(避免刷匿名账号=刷积分) |
| 登录后接续 | 过户完成后**自动触发一次真 compose**(积分 precheck+hold),真文案替换占位文案 |
| 匿名照片上限 | **20 张**(= FREE_PLAN_CREDITS,首本真文案必然跑得起;登录用户维持 100) |
| 匿名相册数 | 每匿名账号 **1 本**,建第二本弹登录 |
| R2 | 匿名阶段完全不写 R2(快照备份、规范原图补传都只在真实账号下跑) |
| 清理 | 每日 cron 删除创建超 **7 天**未绑定的匿名账号,级联删相册 |
| 验证码 | 这期不上 Turnstile,观察到真实滥用再加 |

## 鉴权分层

- `requireAuth`(现状,匿名可过):建相册+analyze、轮询相册、chapter-context、
  story-progress、select-layout、design GET/POST、添加照片、messages GET、fonts/subset
- `requireRealUser`(新增,匿名拒绝,错误码 `ANON_UPGRADE_REQUIRED`):
  design-chat、share、photo-snapshot-upload-url、photo-snapshot、pdf-upload-url、pdf。
  前端统一拦截该错误码 → 弹登录(callbackURL 回当前相册)
- middleware 不动(只查 cookie 存在性,匿名 session 天然通过);
  `/settings`、`/credits`、`/my-albums` 页面级「匿名则跳登录」

## 占位成稿

匿名 `POST design`:照常写封面/底色,但不派发 compose agent job、不建 credit hold,
Web 端确定性填充器把各页文案槽填上示例文案,相册标记 `copySource='placeholder'`,
状态推进到 ready。添加照片的补文案同理走占位。讲故事回答照常存 chapter-context,
留给登录后的真 compose 用。

## 登录后接续

聊天/保存/分享 → 弹登录 → better-auth `onLinkAccount`:相册过户到真实账号、
补发新账号 20 积分、删匿名用户行 → Web 检测 `copySource='placeholder'` 自动派发真
compose(走现有积分/402 逻辑)→ 真文案落地 → 用户继续原操作。

## 限流(三层)

1. **Vercel WAF**(部署配置,不在仓内):按 IP 限 `/api/auth/sign-in/anonymous` 与
   `POST /api/v3/albums`
2. **应用层硬上限**:匿名 20 张/本、1 本/账号、同账号同时仅 1 个进行中 init job
   (天然去重双击发送:重复请求返回已有相册)
3. **IP 记账**(Postgres 滑动窗口,仿 feedback 服务先例):匿名建相册 + 匿名注册,
   每 IP 每小时默认 5 次,超限 429 `RATE_LIMITED`

## 匿名 session 创建时机

落地页浏览不建账号。首次点「发送」时前端 `signIn.anonymous()` → 继续原建相册流程。
HeroComposer 原「无 session 存草稿跳登录」逻辑改为「无 session 建匿名 session 继续」。

## 测试

- 单测:requireRealUser 拒匿名、占位填充器、过户逻辑、限流计数
- 集成:匿名全流程、登录绑定自动真 compose、双击只建一本、超限 429
- 回归:已登录用户现有流程行为不变
