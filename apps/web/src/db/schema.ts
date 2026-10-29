import { AlbumStage, type Page, type PhotoProfile } from '@yujee/contracts';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================
// Enums (docs/web/database.md §8 state machines)
// ============================================

export const albumStatusEnum = pgEnum('album_status', [
  'AGENT_RUNNING',
  'EDITING',
  'COMPLETED',
  'FAILED',
]);

// V3 五环节状态主控 (architecture §6.8 第 4 条). Web is the sole source of truth;
// the Agent never holds stage. Orthogonal to `albums.status` — status tracks the
// init job lifecycle + credits (unchanged), stage tracks which of the five steps
// the user is on + the export gate. Enum members come straight from the contracts
// `AlbumStage` (packages/contracts/src/enums.ts) so there is one source of truth.
// (zod 4 起 `.options` 类型是普通数组,drizzle 的 pgEnum 要非空元组 —— 枚举
// 构造保证非空,这里断言一次。)
export const albumStageEnum = pgEnum('album_stage', AlbumStage.options as [string, ...string[]]);

export const agentJobStatusEnum = pgEnum('agent_job_status', [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);

// v2 rebuild: distinguishes the two async jobs of an album's lifecycle. Their
// failure/zombie semantics are OPPOSITE (init failure → FAILED + release;
// finalize failure → back to EDITING + keep hold), so sweeper/callback branch
// on this. See docs/agent/rebuild-architecture.md §5.
// init = 识图分析(建相册时起,analyze 完成即 COMPLETED);layout = 排版(用户采访完主动
// 触发时另起的独立 job,与 init 解耦,不共用 requestId、不挂积分 hold);compose = 一次性
// 成稿(用户选定封面后派发 /v3/compose,回调统一组页并推 stage='ready')。finalize/add 保留。
export const agentJobKindEnum = pgEnum('agent_job_kind', [
  'init',
  'finalize',
  'add',
  'layout',
  'compose',
]);

export const creditHoldStatusEnum = pgEnum('credit_hold_status', [
  'HOLDING',
  'SETTLED',
  'RELEASED',
]);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);

// 照片真相迁 R2 (Phase 0): server-side registry of each album's canonical photo
// originals. 'uploaded' = original bytes confirmed in R2; 'missing' = known slot
// with no confirmed upload yet. Task 4/5's service upserts this under an album
// row lock; a 'missing' upsert must never downgrade an existing 'uploaded' row.
export const albumPhotoStatusEnum = pgEnum('album_photo_status', ['uploaded', 'missing']);

// Keep the legacy `stripe` enum value for existing production rows and Drizzle
// migration compatibility. New application code writes `creem` only.
export const customerProviderEnum = pgEnum('customer_provider', ['stripe', 'creem']);

export const creditLedgerReasonEnum = pgEnum('credit_ledger_reason', [
  'SIGNUP_BONUS',
  'GENERATION_HOLD',
  'GENERATION_SETTLE',
  'GENERATION_RELEASE',
  'PURCHASE',
  'REFUND',
  'ADMIN_ADJUST',
  'INVITE_REDEEM', // 兑换邀请码 → 加积分(见 invite_codes / invite_redemptions)
  // AI 生图。**刻意不复用 GENERATION_* 那三个**:admin-service 在按
  // GENERATION_SETTLE 求和算营收,生图混进去会把那个指标搅浑。
  // 也不走 creditService.hold() —— 它会往 albums.credit_hold_id 写值,
  // 会覆盖掉正在进行的建书扣费预留。生图是秒级操作,短事务内直接扣、失败退回。
  'IMAGE_GEN_CHARGE',
  'IMAGE_GEN_REFUND',
]);

// ============================================
// better-auth tables (4) — docs/web/database.md §2
// `users.credit_balance` is an additionalField; credit_ledger is source of truth.
// ============================================

export const users = pgTable('users', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAdmin: boolean('is_admin').notNull().default(false),
  // 游客(匿名)账号:better-auth anonymous 插件创建,临时邮箱占位。登录转正时
  // onLinkAccount 过户相册后删除该行;超过 ANON_CLEANUP_DAYS 未转正由 cron 清理。
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  // 手机号注册/登录(2026-10-27,better-auth phoneNumber 插件):当前免验证
  // (requireVerification 默认关),后期接短信后走插件的 send-otp/verify 升级
  // phoneNumberVerified。唯一索引允许 NULL(邮箱老账号没有手机号)。
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified'),
  // Column default aligned to FREE_PLAN_CREDITS (welcome grant). better-auth
  // normally inserts that value explicitly; this default is the fallback for any
  // other insert path. Re-denominated to 20 with the 1-credit-per-photo change
  // (migration 0016). Keep in sync with FREE_PLAN_CREDITS in config/pricing.ts.
  creditBalance: integer('credit_balance').notNull().default(20),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // 更新日志已读水位(2026-10-30):晚于此时间戳的 published 条目算未读。
  changelogLastSeenAt: timestamp('changelog_last_seen_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_accounts_user').on(t.userId),
    providerAccount: uniqueIndex('uq_accounts_provider_account').on(t.providerId, t.accountId),
  }),
);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================
// Payment mapping — docs/web/database.md §3.1
// ============================================

export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: customerProviderEnum('provider').notNull(),
    externalCustomerId: text('external_customer_id').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProvider: uniqueIndex('uq_customers_user_provider').on(t.userId, t.provider),
    providerExternal: uniqueIndex('uq_customers_provider_external').on(
      t.provider,
      t.externalCustomerId,
    ),
    userIdx: index('idx_customers_user').on(t.userId),
  }),
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: customerProviderEnum('provider').notNull(),
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id').notNull(),
    planId: text('plan_id').notNull(),
    billingCycle: text('billing_cycle').notNull(),
    status: text('status').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userPeriodEnd: index('idx_subscriptions_user_period_end').on(
      t.userId,
      t.currentPeriodEnd.desc(),
    ),
    providerSubscription: uniqueIndex('uq_subscriptions_provider_external').on(
      t.provider,
      t.externalSubscriptionId,
    ),
  }),
);

// ============================================
// Album core — docs/web/database.md §3 / §4 / §4.1
// `albums.creditHoldId` intentionally has no FK to break the
// albums ↔ credit_holds cycle; credit_holds.albumId is the strong link.
// ============================================

export const albums = pgTable(
  'albums',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: albumStatusEnum('status').notNull().default('AGENT_RUNNING'),
    // V3 五环节状态 (architecture §6.8 第 4 条). Orthogonal to `status`, not derived
    // from it. New albums start at 'analysing'; existing rows are backfilled in
    // migration 0009 (status COMPLETED/EDITING → 'ready', AGENT_RUNNING → 'analysing').
    stage: albumStageEnum('stage').notNull().default('analysing'),
    prompt: text('prompt').notNull(),
    layoutJson: jsonb('layout_json'),
    // V3 authoring tree / preview pages, lives only during the draft phase.
    // null = v1 album. Discriminator draft vs finalized = layoutJson IS NULL.
    // See docs/agent/rebuild-architecture.md §4.1 / §5.
    draftJson: jsonb('draft_json'),
    // draft_pages 拆表(Phase 1a): monotonic revision for the whole book's draft
    // pages. Every draft write transaction bumps this by 1 and stamps the
    // written row(s)' `version` with the NEW revision — page versions are
    // comparable book-wide, and a full-book replace (reorder/select-layout/
    // compose/design-chat) naturally advances every page's version. 0 = no
    // draft_pages rows yet (legacy-only album). See docs/plans/2026-08-03-draft-pages-split.md.
    draftRevision: bigint('draft_revision', { mode: 'number' }).notNull().default(0),
    // 协同增量同步(2026-08-27 collab plan §7.4):最后一次「结构/整书级写入」
    // (reorder/delete/add/select-layout/compose/design-chat/replaceAll)落地时的
    // draft_revision。普通单页 updatePage 只推进 draft_revision、不动它。客户端
    // since < 该值 ⇒ 页面集合可能删行/重排,必须整书重载;since >= 该值 ⇒ 可以安全
    // 应用 version > since 的单页增量。0 = 尚无结构写入(全量播种前的初值)。
    draftStructureRevision: bigint('draft_structure_revision', { mode: 'number' })
      .notNull()
      .default(0),
    // 全局创作设置 OCC(Phase 2B):title / board_background / photo_filter 三个
    // 相册级设置的乐观并发基线。每次设置写事务内精确比较,成功 +1、失配 409
    // SETTINGS_CONFLICT 零写入。与 draft_revision(页集合)、draft_structure_revision
    // (页结构)刻意分离 —— 三类写点互不干扰,拿错版本号只会让对应写点误判冲突。
    // 0 = 尚无任何设置写(初值)。
    settingsRevision: integer('settings_revision').notNull().default(0),
    photoCount: integer('photo_count').notNull(),
    pageCount: integer('page_count').notNull().default(0),
    pdfR2Key: text('pdf_r2_key'),
    pdfUrl: text('pdf_url'),
    coverThumbnailR2Key: text('cover_thumbnail_r2_key'),
    coverThumbnailUrl: text('cover_thumbnail_url'),
    // 手动照片备份(photo-snapshot-design.md):用户主动「保存」后,把书里用到照片的
    // 当前 display 派生图直传 R2,记录 photoId + 精确 renderVersion + 更新时间。
    // null = 从未备份。原图仍只在浏览器;旧行可没有 renderVersions。
    photoSnapshot: jsonb('photo_snapshot').$type<{
      photoIds: string[];
      renderVersions?: Record<string, string>;
      updatedAt: string;
    }>(),
    // 预览「垫底背景」(相册级):书页浮在其上的画板底。纯色 / 内置实拍预设 / 用户上传图。
    // upload.key 是本地 blob 引用(只存本地,服务端不落图,换设备解析为空)。
    // null = 无(默认中性画板)。导出多跨页拼图也读它,保证所见即所分享。
    boardBackground: jsonb('board_background').$type<
      { kind: 'color'; color: string } | { kind: 'preset'; presetId: string } | { kind: 'upload'; key: string }
    >(),
    photoFilter: jsonb('photo_filter').$type<PhotoFilterState>(),
    // 成稿文案来源:'placeholder' = 匿名占位成稿(模板 sample 文案,零 AI),
    // 'ai' = 真 compose 已写,null = 尚未成稿/历史相册。登录后前端看到 'placeholder'
    // 会自动重发 POST /design 补跑真 compose(此时才计费)。
    copySource: text('copy_source'),
    creditHoldId: text('credit_hold_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreated: index('idx_albums_user_created').on(t.userId, t.createdAt.desc()),
    activeStatus: index('idx_albums_active')
      .on(t.status)
      .where(sql`${t.status} in ('AGENT_RUNNING', 'EDITING')`),
  }),
);

export const albumPages = pgTable(
  'album_pages',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    pageIndex: integer('page_index').notNull(),
    templateId: text('template_id').notNull(),
    imagesJson: jsonb('images_json').notNull().default({}),
    textsJson: jsonb('texts_json').notNull().default({}),
    // Per-slot position/scale overrides (#165), keyed by the same slotId as
    // images_json. Defaults to {} so pre-#165 rows render at 50/50/1 unchanged.
    imagePosJson: jsonb('image_pos_json').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    albumIndex: uniqueIndex('uq_album_pages_album_index').on(t.albumId, t.pageIndex),
    album: index('idx_album_pages_album').on(t.albumId),
  }),
);

// draft_pages 拆表(Phase 1a):V3 draft 页的每页一行真相,取代
// `albums.draft_json.pages` 数组(legacy 字段只读回退,新写点永不再写它)。PK
// (albumId, pageIndex)。`page` 一律 contracts `Page`(strict)。`version` = 写入
// 该行时的新 `albums.draft_revision`(全书单调可比);`updatedBy` null 表示
// 系统/agent 写入(而非某个用户)。docs/plans/2026-08-03-draft-pages-split.md。
export const draftPages = pgTable(
  'draft_pages',
  {
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    pageIndex: integer('page_index').notNull(),
    page: jsonb('page').$type<Page>().notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    updatedBy: text('updated_by'), // null = 系统/agent 写入
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.albumId, t.pageIndex] }),
  }),
);

// 照片原图登记表(照片真相迁 R2 Phase 0):album 级别的原图台账,记录每张照片的
// 上传状态与像素/字节元信息。Task 4/5 的 service 在 album 行锁内 upsert 这张表。
export const albumPhotos = pgTable(
  'album_photos',
  {
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    photoId: text('photo_id').notNull(),
    status: albumPhotoStatusEnum('status').notNull().default('uploaded'),
    // 最后一个把原图 PUT 上来的 Creator(collab rework §3.3)。照片入册即共享素材:
    // 成员移除/账号删除不回收素材(set null),删除规则(只能删自己上传且未被
    // 页面引用的)由未来删除 API 按这道署名执行。
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    // 照片视觉档案(几何/色彩/语义三组)。契约:packages/contracts/src/photo-profile.ts
    // 存这里而不是 draft_json:档案是照片的属性,且 draft_json 被整体重写过(b4cba3f1)。
    // null = 还没建档(存量书 / 建档失败),读取方一律要能降级。
    profile: jsonb('profile').$type<PhotoProfile>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.albumId, t.photoId] }),
  }),
);

// 相册分享链接(免登只读):生成时把当前定稿「冻结」成自包含 HTML 快照(图片已换成
// 公开 R2 快照图 URL),存这张表。公开路由 /{locale}/s/{token} 只按 token 查、不校验归属,
// 任何人可看。原图仍只在浏览器;这里存的 html 里图片一律是公开快照 URL,免登也能显示。
// 冻结:生成后相册继续编辑不影响已发链接;重新生成创建**新**链接(collab rework
// §3.1:独立 token,editor 建新分享不撤销 owner 已发的链接),旧链接继续可读。
export const albumShares = pgTable(
  'album_shares',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    // 随机不可猜的分享令牌(URL 里那段);唯一。撤销/过期本期不做,靠令牌不可猜提供基础隐私。
    token: text('token').notNull(),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    // 快照时的标题(相册后续改名不影响已发链接)。
    title: text('title').notNull(),
    // 冻结的自包含渲染:页面数据(定稿 album_pages 的快照)+ 每个 photoId 的公开快照 URL
    // (免登也能显示)+ 画板底色 + 语言。分享页用 FlipBook 按这套数据 + photoUrls 渲染真翻书。
    snapshotJson: jsonb('snapshot_json')
      .notNull()
      .$type<{
        pages: Array<{
          pageIndex: number;
          templateId: string;
          imagesJson: Record<string, string>;
          textsJson: Record<string, string>;
          imagePosJson?: Record<string, { x: number; y: number; scale: number }>;
          // 页面 HTML 真相(C 方案):存在时 FlipBook 优先渲染它(保留 AI/手工版面),
          // 图片 {{IMG_SRC}} token 由 resolveImage 换成公开快照 URL。
          htmlJson?: string;
        }>;
        photoUrls: Record<string, string>;
        boardBackground:
          | { kind: 'color'; color: string }
          | { kind: 'preset'; presetId: string }
          | { kind: 'upload'; key: string }
          | null;
        locale: string;
      }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    token: uniqueIndex('uq_album_shares_token').on(t.token),
    // 每相册可有多条(一链接一行);按相册找最新用 album+created_at 查询。
    album: index('idx_album_shares_album').on(t.albumId, t.createdAt),
  }),
);

// 协同编辑成员表(2026-08-27 collab plan §6.1):相册的 editor 名单。owner 永远
// 不出现在这里 —— `albums.user_id` 是 owner 的唯一真相,这张表只表达"被邀请进来
// 的 editor"。第一版无角色列:存在即 editor。redeem 用 ON CONFLICT DO NOTHING
// 幂等;相册/用户删除级联清理。结构/AI 整书写点与成员加入在相册行锁事务内
// 串行(Phase 2A 起不再用「存在即冻结」,改由结构 OCC 收敛并发)。
export const albumMembers = pgTable(
  'album_members',
  {
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.albumId, t.userId] }),
    // 「按用户查加入的相册」与成员列表排序都走这个。
    userCreated: index('idx_album_members_user').on(t.userId, t.createdAt.desc()),
  }),
);

// 协同编辑邀请链接(2026-08-27 collab plan §6.2):一册最多一条(重新生成=旋转
// token,旧链接立即失效,即最小撤销机制)。只存 token 的 SHA-256 hash,明文仅在
// 创建/旋转响应里返回一次。token 由 service 层用 ≥32 字节 CSPRNG 生成。
export const albumEditLinks = pgTable(
  'album_edit_links',
  {
    albumId: text('album_id')
      .primaryKey()
      .references(() => albums.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHash: uniqueIndex('uq_album_edit_links_token_hash').on(t.tokenHash),
  }),
);

// 用户反馈(用户菜单"反馈与问题"表单):落库存档 + 转发邮件到运营收件箱。
// 限频依据:同一 user 最近一小时的行数。
export const feedback = pgTable(
  'feedback',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    // 提交时用户所在页面路径(前端带上,便于定位问题;可空)。
    page: text('page'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_feedback_user_id').on(t.userId)],
);

export const albumMessages = pgTable(
  'album_messages',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    layoutPatch: jsonb('layout_patch'),
    usage: jsonb('usage'),
    // v2 rebuild: groups per-chapter (Stage 4) dialogue. null = v1 chat-edit message.
    chapterId: text('chapter_id'),
    // 会话历史顺序的单一真相:每相册单调自增(repo.create 赋值)。历史按「发生即追加」
    // 的顺序写入并按 seq 回放,不再靠 created_at 排序(同事务 INSERT 时间戳相同会乱序)。
    seq: integer('seq').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 排序主索引 + 物理保证「一相册内 seq 不重」,并发重复写会撞唯一约束而非静默乱序。
    albumSeq: uniqueIndex('uq_album_messages_album_seq').on(t.albumId, t.seq),
    userCreated: index('idx_album_messages_user_created').on(t.userId, t.createdAt.desc()),
    albumChapterSeq: index('idx_album_messages_album_chapter_seq').on(
      t.albumId,
      t.chapterId,
      t.seq,
    ),
  }),
);

// ============================================
// Agent jobs — docs/web/database.md §5
// ============================================

export const agentJobs = pgTable(
  'agent_jobs',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    requestId: text('request_id').notNull().unique(),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: agentJobStatusEnum('status').notNull().default('QUEUED'),
    // v2 rebuild: init vs finalize. Existing rows default to 'init'. Drives the
    // failed/zombie branch (init→FAILED+release, finalize→EDITING+keep hold).
    kind: agentJobKindEnum('kind').notNull().default('init'),
    stage: text('stage'),
    progress: integer('progress').notNull().default(0),
    usage: jsonb('usage'),
    // 追加照片(加图增量重跑):layout job 用 { appendChapterIds: string[] } 标记追加
    // 范围,完成回调据此走「插入合并」而非整表替换。普通全书排版为 null。
    meta: jsonb('meta'),
    error: jsonb('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when QUEUED→RUNNING, then refreshed on every progress callback — it is
    // a last-activity heartbeat, not a fixed start time. Zombie staleness checks
    // (read-path sweep + daily cron) measure "no progress since startedAt".
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    userCreated: index('idx_agent_jobs_user_created').on(t.userId, t.createdAt.desc()),
    runningStartedAt: index('idx_agent_jobs_running_started')
      .on(t.startedAt)
      .where(sql`${t.status} = 'RUNNING'`),
    // v2 rebuild: DB backstop for "one active job per (album, kind)". The app
    // also uses a compare-and-swap on albums.status as the primary lock; this
    // index makes a concurrent double-click physically impossible to commit.
    // See docs/agent/rebuild-tech-plan.md §11.
    albumKindActive: uniqueIndex('uq_agent_jobs_album_kind_active')
      .on(t.albumId, t.kind)
      .where(sql`${t.status} in ('QUEUED', 'RUNNING')`),
    // Supports findLatestByAlbum: the album-uuid read path looks up the newest
    // job per album on every 15s poll while AGENT_RUNNING (docs/web/api.md §3.4).
    albumCreated: index('idx_agent_jobs_album_created').on(t.albumId, t.createdAt.desc()),
  }),
);

// ============================================
// Credits — docs/web/database.md §6 / §7
// credit_ledger fields are a minimal draft; see PR description for
// the open question to the architect.
// ============================================

export const creditHolds = pgTable(
  'credit_holds',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    status: creditHoldStatusEnum('status').notNull().default('HOLDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => ({
    userCreated: index('idx_credit_holds_user_created').on(t.userId, t.createdAt.desc()),
    activeStatus: index('idx_credit_holds_holding')
      .on(t.status)
      .where(sql`${t.status} = 'HOLDING'`),
  }),
);

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    reason: creditLedgerReasonEnum('reason').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    relatedAlbumId: text('related_album_id').references(() => albums.id, {
      onDelete: 'set null',
    }),
    relatedHoldId: text('related_hold_id').references(() => creditHolds.id, {
      onDelete: 'set null',
    }),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreated: index('idx_credit_ledger_user_created').on(t.userId, t.createdAt.desc()),
  }),
);

// 邀请码(共享兑换码):一个码可发给很多人,每个用户限兑一次(见 invite_redemptions
// 的唯一约束),到期(expires_at)或停用(active=false)后拒绝。maxRedemptions=null
// 表示无总次数上限。兑换 = creditService.applyDelta(+credits, 'INVITE_REDEEM')。
export const inviteCodes = pgTable(
  'invite_codes',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    code: text('code').notNull().unique(), // 存大写规整值;兑换时用户输入 upper+trim 后比对
    credits: integer('credits').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxRedemptions: integer('max_redemptions'), // null = 不限总次数(仍每人一次)
    redeemedCount: integer('redeemed_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex('uq_invite_codes_code').on(t.code),
  }),
);

// 兑换记录:每个用户对每个码只能有一条(唯一约束防重复兑),是「每人限一次」的硬闸。
export const inviteRedemptions = pgTable(
  'invite_redemptions',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    codeId: text('code_id')
      .notNull()
      .references(() => inviteCodes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perUser: uniqueIndex('uq_invite_redemptions_code_user').on(t.codeId, t.userId),
  }),
);

// ============================================
// Type exports
// ============================================

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type AlbumPage = typeof albumPages.$inferSelect;
export type NewAlbumPage = typeof albumPages.$inferInsert;
export type DraftPage = typeof draftPages.$inferSelect;
export type NewDraftPage = typeof draftPages.$inferInsert;
// AI 生图留痕。两个用途,缺一不可:
// 1. **可追责** —— 自由描述意味着用户能让模型生成任何东西,prompt 必须存下来,
//    出事时能查是谁在什么时候用什么描述生成的。
// 2. **免费重生成计数** —— 每笔付费生成附带 1 次免费重来(见 spec「尺寸与成本」,
//    次数是按毛利算出来的)。计数存在这里,不存在客户端。
// photoId 指向 album_photos 里那张图;生成失败(退了积分)的那次不落行。
export const imageGenerations = pgTable(
  'image_generations',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()`),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    photoId: text('photo_id').notNull(),
    // 用户填的原文(清洗后、拼进承重墙之前的那段),不是最终发给上游的整串。
    prompt: text('prompt').notNull(),
    provider: text('provider').notNull(),
    freeRetriesUsed: integer('free_retries_used').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    albumCreated: index('idx_image_generations_album_created').on(t.albumId, t.createdAt.desc()),
  }),
);

export type ImageGeneration = typeof imageGenerations.$inferSelect;
export type NewImageGeneration = typeof imageGenerations.$inferInsert;

export type AlbumPhoto = typeof albumPhotos.$inferSelect;
export type NewAlbumPhoto = typeof albumPhotos.$inferInsert;
export type AlbumShare = typeof albumShares.$inferSelect;
export type NewAlbumShare = typeof albumShares.$inferInsert;
export type AlbumMember = typeof albumMembers.$inferSelect;
export type NewAlbumMember = typeof albumMembers.$inferInsert;
export type AlbumEditLink = typeof albumEditLinks.$inferSelect;
export type NewAlbumEditLink = typeof albumEditLinks.$inferInsert;
export type AlbumMessage = typeof albumMessages.$inferSelect;
export type NewAlbumMessage = typeof albumMessages.$inferInsert;

export type AgentJob = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;

export type CreditHold = typeof creditHolds.$inferSelect;
export type NewCreditHold = typeof creditHolds.$inferInsert;
export type CreditLedger = typeof creditLedger.$inferSelect;
export type NewCreditLedger = typeof creditLedger.$inferInsert;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type NewInviteCode = typeof inviteCodes.$inferInsert;
export type InviteRedemption = typeof inviteRedemptions.$inferSelect;
export type NewInviteRedemption = typeof inviteRedemptions.$inferInsert;

// 模型配置覆盖(2026-10-30 管理后台模型设置页用):key-value 覆盖 env 默认值。
// 只存模型名,不存 API key(安全红线:key 留在服务器 env)。
// key 枚举:compose_model / design_model / image_model。
export const modelConfig = pgTable('model_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

// 更新日志(2026-10-30,需求池「产品更新日志系统」):面向用户的产品变更记录。
// 管理员手动编辑发布(不做自动从 git 发布);中英文各存一份。
export const changelogEntries = pgTable('changelog_entries', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()`),
  category: text('category').notNull(), // feature / improvement / notice / fix
  titleZh: text('title_zh').notNull(),
  titleEn: text('title_en').notNull(),
  bodyZh: text('body_zh').notNull(),
  bodyEn: text('body_en').notNull(),
  imageUrl: text('image_url'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  isPublished: boolean('is_published').notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
