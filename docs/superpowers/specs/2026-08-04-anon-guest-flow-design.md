# 匿名免登录排版(游客模式)设计

日期:2026-08-04
分支:feat/anon-guest-flow

## 目标

登录墙从「落地页点发送」后移:匿名用户不登录即可走完 发送 → CLIP 分组 → 讲故事 →
选版 → 挑封面/底色 → 画板看成书 → 添加照片 → 导出 全流程。只有三件事要求登录:

1. 在 Agent 对话框里打字(design-chat)——**实施订正(上线首日实测)**:打字不再硬
   跳转登录页(会把讲故事讲一半的游客甩出编辑器、输入丢失),改为输入框上方亮一条
   迷你登录横幅(#guestAlert,buy-banner 同款,可关闭,不锁输入);占位成书后也会
   自动亮一次。保存/分享仍是带回跳的登录跳转
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
| 清理 | ~~每日 cron 删除创建超 **7 天**未绑定的匿名账号,级联删相册~~ **2026-08-20 推翻**:只删「一本书都没做」的空游客;做过书的游客永久保留 |
| 验证码 | 这期不上 Turnstile,观察到真实滥用再加 |

> **2026-08-20 清理策略推翻。** 原设计按 7 天删光未转正的匿名账号(连书一起)。实际运行后
> 判断这是在扔掉转化漏斗上最有价值的样本:一个游客肯做完一本书,意味着他传了照片、等过
> 生成、翻过成品 —— 这是产品里最强的购买意向信号,删掉连「你的书还在,注册就能保存」这种
> 召回话术都失效,漏斗也再算不出来。
>
> 现在:`userRepo.findAnonymousCreatedBefore` 加 `NOT EXISTS(albums)`,只扫纯粹来了没
> 动手的空壳(防刷号撑爆库);`albumRepo.findFailedOlderThan` 同步排除游客,堵掉「FAILED
> 书先被 cleanupAbandoned 删、次日人就变空游客被清」的两步后门。
>
> **2026-08-21 拍板:游客照片不落 R2,维持原样。** 「匿名阶段完全不写 R2」这条继续有效,
> 游客的原图在服务端没有任何长期副本(`analyze-uploads/` 是 1 天过期的中转,
> `uploadSessionId` 不落库),只在他自己浏览器的 IndexedDB 里。
>
> 因此后台 `/admin/albums/[uuid]` 对游客相册**永远看不到图**,这是预期行为不是故障 ——
> 预览页会显式告知缺了几张、为什么。能看到的是版式、文案、他做到哪一步就走了,这些
> 已足够判断流失点。别再把它当待办来「修」。

## 鉴权分层

- `requireAuth`(现状,匿名可过):建相册+analyze、轮询相册、chapter-context、
  story-progress、select-layout、design GET/POST、添加照片、messages GET、fonts/subset
- `requireRealUser`(新增,匿名拒绝,错误码 `ANON_UPGRADE_REQUIRED`):
  design-chat、share、photo-snapshot-upload-url、photo-snapshot、pdf-upload-url、pdf。
  前端统一拦截该错误码 → 弹登录(callbackURL 回当前相册)
- middleware 不动(只查 cookie 存在性,匿名 session 天然通过);
  `/settings`、`/credits`、`/my-albums` 页面级「匿名则跳登录」

## 占位成稿(实施订正)

内页示例文案**不需要另造**:select-layout 落地时 engine 的 `fill_sample_texts` 已把
模板 sample 填进每页 texts。匿名 `POST design` 走 `applyPlaceholderDesign`:复用真成稿
同一条纯函数 `mergeComposeIntoDraft` 传**空 compose 载荷**(内页保留 sample、封面/封尾
落模板 sample、字体按语言兜底、carrier+重烘+页序照旧),同步落库,不派 agent job、
不建 hold,相册标记 `copySource='placeholder'`,stage 推进到 ready。添加照片的补文案
同理(匿名 composeAppend 直接 `composed:false`,sample 已由追加排版填好)。讲故事回答
照常存 chapter-context,留给登录后的真 compose 用。

## 登录后接续

聊天/保存/分享 → 弹登录 → better-auth `onLinkAccount`:相册过户到真实账号、
补发新账号 20 积分、删匿名用户行 → Web 检测 `copySource='placeholder'` 自动派发真
compose(走现有积分/402 逻辑)→ 真文案落地 → 用户继续原操作。

## 限流(三层)

1. **Vercel WAF**(部署配置,不在仓内):按 IP 限 `/api/auth/sign-in/anonymous` 与
   `POST /api/v3/albums`
2. **应用层硬上限**:匿名 20 张/本、1 本/账号、同账号同时仅 1 个进行中 init job
   (天然去重双击发送:重复请求返回已有相册)
3. **IP 记账**(实施订正:收敛到注册口):匿名注册 `/sign-in/anonymous` 每 IP 每小时
   5 次(better-auth before-hook 数 `sessions.ip_address` join `is_anonymous`,429);
   叠加「每匿名账号 1 本」后等效于匿名建相册 ≤5 本/IP/小时,无需再单独记账建相册口

## 匿名 session 创建时机

落地页浏览不建账号。首次点「发送」时前端 `signIn.anonymous()` → 继续原建相册流程。
HeroComposer 原「无 session 存草稿跳登录」逻辑改为「无 session 建匿名 session 继续」。

## 测试

- 单测:requireRealUser 拒匿名、占位填充器、过户逻辑、限流计数
- 集成:匿名全流程、登录绑定自动真 compose、双击只建一本、超限 429
- 回归:已登录用户现有流程行为不变
