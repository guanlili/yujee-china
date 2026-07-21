# 相册分享链接(免登只读)— 设计说明

需求(用户拍板):生成一个链接,被分享者**不用注册**就能看到相册。**冻结快照**(生成那一刻定住,后续编辑不影响已发链接)、**翻书只读**、**不需要**撤销/有效期/密码。

## 关键约束(来自现有架构)
- 相册**原图只在浏览器 IndexedDB**,不上服务器。服务器上只有用户手动「保存」后上传到**公开读 R2** 的 display 档压缩快照图(`albums.photoSnapshot` + key 约定 `photo-snapshots/{userId}/{albumId}/{photoId}.jpg`)。
- 页面鉴权两层:middleware 按 cookie 拦 `/album/*`(`protectedPaths`);数据 API `requireAuth` + `findOwned` 强制归属。
- C 方案「页面真相=HTML」:`renderPageHtml`(`@yujee/contracts/render`,纯函数)+ 只读组件 `FittedPageHtml`/`FlipBook` 可复用。

## 方案:自包含快照
**核心**:生成分享时,在**owner 浏览器**里把每页烘成 HTML,并把图片 token 换成**公开快照 URL**(不是本地 blob)。分享页因此**完全自包含**,接收者浏览器不需要任何本地数据。

### 生成(owner,已登录)
1. 确保该相册照片**全量快照**已传公开 R2(复用现有 photo-snapshot 上传通道;缺的补传,传不齐则提示、不发半残链接)。
2. 浏览器烘每页 HTML,图片=公开快照 URL。
3. `POST /api/v1/albums/{uuid}/share`(requireAuth + findOwned)→ upsert `album_shares`(一相册一条,重发=覆盖):`token`(随机不可猜)+ `snapshotJson{pages[].html, boardBackground, locale}` + `title`。
4. 返回 `/{locale}/s/{token}`。

### 查看(接收者,免登)
- 新路由 `/{locale}/s/[token]/page.tsx` —— **不在 `/album` 前缀**,middleware 不拦(不会 307)。
- 服务端组件直接按 token 查 `album_shares`(**不校验归属**)→ 渲染只读翻书(`FittedPageHtml`/`FlipBook`)。html 里图片是公开 URL,任何人可见。
- `robots: noindex`。token 查不到 → 404。

## 数据表 `album_shares`
`token(uniq)`、`albumId(FK→albums, uniq, 一相册一条)`、`title`、`snapshotJson(jsonb)`、时间戳。见 `db/schema.ts`。

## 影响面 / 部署
- 纯 Web:DB(1 表 + migration)、2 个 API 面(已登录 POST + 公开读)、1 个公开路由、编辑器 1 个入口。**不碰 engine/契约**。
- 部署走 Vercel(build 自动跑 migration);Fly 不涉及。
- 隐私:R2 公开读桶,快照图/分享页靠**不可猜 token/key** 提供隐私(不做签名鉴权);分享页 noindex。
