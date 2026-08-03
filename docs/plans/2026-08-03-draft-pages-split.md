# draft_pages 拆表(Phase 1a)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `albums.draftJson` 里的 `pages` 数组拆成每页一行的 `draft_pages` 表(带 `version`/`updatedBy`),单人产品行为零变化,为 Phase 1b 的页锁与协作轮询铺底。

**Architecture:** `draftJson` 瘦身为 envelope(`{version, tree, progress, design}`),页真相迁入 `draft_pages`(PK `(albumId, pageIndex)`,`page` jsonb 存 contracts `Page`)。`albums` 新增 `draft_revision` bigint:**每次任何 draft 写入 +1,写入的行 `version` = 新 revision**——页版本全书单调可比,整书替换(reorder/select-layout/compose/design-chat)天然把所有页版本推进,Phase 1b 的 CAS 与 `since` 游标直接用它。读层新增 `loadStoryDraft`(优先 draft_pages,**全书无行时回退 legacy `draftJson.pages`**);写层统一先 `ensureDraftPagesSeeded`(懒播种:无行相册在同事务内先从 legacy pages 铺行),再行级写。**顺手修四个侦察确认的正确性缺陷**:job 回调写点补 album 行锁、`saveChapterContexts` 停止搬运 pages、`pageCount` 在所有页数变化写点收口、`design.pageBackground` 进契约不再被 zod 往返丢弃。engine/design-agent 零改动;`album_pages`(v1/v2 遗留表)不碰;分享冻结语义(不烘、有啥发啥)不变。

**Tech Stack:** Drizzle + Postgres(迁移含 jsonb 数据回填)· node:test + tsx · 设计文档 `docs/specs/2026-08-02-collab-editing-design.md`(Phase 1 数据模型章)

## Global Constraints

- 测试/env 预置/单文件跑法/仓根 typecheck 只在最后跑/在途脏文件警戒/`git add` 只加本任务文件/commit 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` —— **全部沿用 `docs/plans/2026-08-02-photo-originals-r2.md` 的 Global Constraints**,不再重抄;实施者先读那一节。
- 本地 **不要跑 `db:migrate`**(dev 库 drizzle 账本 hash 漂移,先于本工程):新迁移用 psql 直接执行生成的 SQL(幂等写法),报告里写明。
- 页对象形状一律 contracts `Page`(`packages/contracts/src/layout.ts:76-111`,strict);`draft_pages.page` 列 `$type<Page>()`。
- **每个 draft 写事务的固定次序**:`albumRepo.findByIdForUpdate`(album 行锁)→ `ensureDraftPagesSeeded` → 行级写 → `draft_revision = revision + 1` 且写入行 `version = 新 revision` → 需要时更新 `pageCount`。job 回调写点也不例外(这是对现状四个无锁写点的修复,刻意为之)。
- **读语义不变式**:`loadStoryDraft` 保持「读时现场烘 html、不回写库」(bakePagesHtml strict:false);share 冻结路径保持**不烘**;`readPreviewPages` 的行为由新读层等价承接。
- 单人行为零变化是验收底线:现有 draftJson 相关测试(清单见侦察报告,Task 11 全跑)只允许因「构造 fixture 的方式」改动,断言语义不许变。
- 存量兼容:`draftJson.pages` 一律**只读回退**,新写点永不再写它;不做删除 legacy 字段的迁移(观察期后另行清理)。

## 文件结构

**新建**
- `apps/web/src/db/repos/draft-page-repo.ts`(+ `.test.ts`) — draft_pages repo
- `apps/web/src/services/album/draft-store.ts`(+ `.test.ts`) — `loadStoryDraft` / `ensureDraftPagesSeeded` / envelope 读写助手(拆表后的唯一 draft 存取层)
- `apps/web/src/db/migrations/`(db:generate 产物 + 手写数据回填迁移)

**修改**
- `apps/web/src/db/schema.ts` — draft_pages 表 + `albums.draft_revision`
- `apps/web/src/db/repos/__test__/setup.ts` — cleanupUser 补删
- `packages/contracts/src/v3.ts` — `V3StoryDraft.design` 增加 `pageBackground?`
- `apps/web/src/services/album/album-service.ts` — 全部读写点切换(updatePage/reorderPages/persistDesignChat/saveChapterContexts/markChapterDone/getDraftSkeleton/getChapterSummary/getStoryProgress/getInternalAgentData/prepareDesignChat/coverThumbnailRevision/assertStoryExportUnlocked/fallbackCoverPhotoIds/listCoverSets/applyDesign/delete)
- `apps/web/src/services/job/job-service.ts` — 三个回调写点(analyze-append/select-layout/compose)加锁 + 切行级写
- `apps/web/src/services/album/share-service.ts`、`apps/web/src/services/generation/generation-service.ts` — 读点切换
- `README.md`、`CLAUDE.md`、`apps/web/README.md` — 页面真相段落 + doc-scope

---

### Task 1: draft_pages 表 + draft_revision + 回填迁移 + repo

**Files:**
- Modify: `apps/web/src/db/schema.ts`、`apps/web/src/db/repos/__test__/setup.ts`
- Create: `apps/web/src/db/repos/draft-page-repo.ts`、迁移(db:generate 产物 + 手写回填 SQL)
- Test: `apps/web/src/db/repos/draft-page-repo.test.ts`

**Interfaces:**
- Consumes: `DbOrTx`、`albumPages` 的 albumId FK 写法(逐字镜像,onDelete cascade)、contracts `Page`
- Produces(Task 2+ 消费,签名逐字):

```ts
// schema.ts
export const draftPages = pgTable('draft_pages', {
  albumId: /* 镜像 albumPages.albumId */,
  pageIndex: integer('page_index').notNull(),
  page: jsonb('page').$type<Page>().notNull(),
  version: bigint('version', { mode: 'number' }).notNull(),
  updatedBy: text('updated_by'),            // null = 系统/agent 写入
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.albumId, t.pageIndex] }) }));
export type DraftPage = typeof draftPages.$inferSelect;
// albums 表追加: draftRevision: bigint('draft_revision', { mode: 'number' }).notNull().default(0)

// draft-page-repo.ts
export const draftPageRepo = {
  findByAlbum: (albumId: string, tx: DbOrTx = db) => Promise<DraftPage[]>,      // 按 pageIndex 升序
  countByAlbum: (albumId: string, tx: DbOrTx = db) => Promise<number>,
  updateOne: (tx: DbOrTx, albumId: string, pageIndex: number, page: Page, version: number, updatedBy: string | null) => Promise<void>,
  replaceAll: (tx: DbOrTx, albumId: string, pages: Page[], version: number, updatedBy: string | null) => Promise<void>,  // delete + bulk insert
  deleteByAlbum: (tx: DbOrTx, albumId: string) => Promise<void>,
};
```

- [ ] **Step 1: 写失败测试** — 照抄 `album-photo-repo.test.ts` 结构(isDbReachable skip + makeUser/makeAlbum + try/finally cleanupUser),覆盖:replaceAll 落行且按序读回、updateOne 单行替换与 version 写入、replaceAll 幂等重跑、deleteByAlbum 清空、页对象经 jsonb 往返逐字段一致(含 html 与 imagePos.rotate)。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @yujee/web exec tsx --test src/db/repos/draft-page-repo.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**
  1. schema 两处新增;`pnpm --filter @yujee/web db:generate`。
  2. **手写第二个迁移**(数据回填,幂等,补 `meta/_journal.json` 条目,参照 0020 的手工条目写法):

```sql
-- 把存量 draftJson.pages 铺进 draft_pages,version 统一取 1,draft_revision 置 1
INSERT INTO draft_pages (album_id, page_index, page, version, updated_by)
SELECT a.id, (p.elem->>'pageIndex')::int, p.elem, 1, NULL
FROM albums a, LATERAL jsonb_array_elements(a.draft_json->'pages') WITH ORDINALITY AS p(elem, ord)
WHERE jsonb_typeof(a.draft_json->'pages') = 'array'
ON CONFLICT (album_id, page_index) DO NOTHING;
--> statement-breakpoint
UPDATE albums SET draft_revision = 1
WHERE draft_revision = 0 AND jsonb_typeof(draft_json->'pages') = 'array';
```

  3. repo 按 Interfaces 实现;`replaceAll` = `deleteByAlbum` + 批量 insert(同事务)。
  4. `cleanupUser` 补 draft_pages 删除(与 albumPages 同款子查询)。
  5. 两个迁移用 psql 手工应用到本地库(不跑 db:migrate),报告写明。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @yujee/web exec tsx --test src/db/repos/draft-page-repo.test.ts src/db/repos/album-repo.test.ts && pnpm --filter @yujee/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/schema.ts apps/web/src/db/migrations apps/web/src/db/repos/draft-page-repo.ts apps/web/src/db/repos/draft-page-repo.test.ts apps/web/src/db/repos/__test__/setup.ts
git commit -m "feat(web): draft_pages 表 + draft_revision + 存量回填迁移

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: draft-store 存取层(loadStoryDraft / ensureDraftPagesSeeded / 写助手)

**Files:**
- Create: `apps/web/src/services/album/draft-store.ts`
- Test: `apps/web/src/services/album/draft-store.test.ts`

**Interfaces:**
- Consumes: Task 1 repo 全部、`readStoryDraft` 现有 envelope 解析逻辑(`album-service.ts:144`,拆出可复用部分)、`bakePagesHtml`
- Produces(后续所有任务消费,签名逐字):

```ts
export type DraftEnvelope = { tree: V3LayoutTreeT; progress: V3StoryProgress; design?: Record<string, unknown> };
export type LoadedDraft = DraftEnvelope & { pages: Page[]; revision: number };

// 读:优先 draft_pages;count===0 时回退 legacy draftJson.pages(只读,不播种)。
// bake 开关:默认 { bake: true }(strict:false 现场烘,不回写);share 路径传 { bake: false }。
// album 参数是已读到的 albums 行(避免重复查询);tx 可选(行锁事务内传 tx 保证读到锁内状态)。
export function loadStoryDraft(album: Album, opts?: { bake?: boolean; tx?: DbOrTx }): Promise<LoadedDraft | null>;
// null 语义:envelope 无法解析即 null(行存在时记 error 日志、行数据不动,留待修复);
// 行不存在且 legacy 也无 pages 亦为 null。

// 写前播种:album 行锁内调用。已有行 → 直接返回当前 revision;无行且 legacy 有 pages →
// 按 legacy pages replaceAll(version=1)并把 draft_revision 置 1,返回 1;两者皆无 → 返回当前 revision。
export function ensureDraftPagesSeeded(tx: DbOrTx, album: Album): Promise<number>;

// envelope 写助手:只写 {version:'v3-story', tree, progress, design},绝不含 pages。
export function envelopeJson(env: DraftEnvelope): Record<string, unknown>;

// revision 推进助手:返回 next revision 并 UPDATE albums SET draft_revision(不写其他列)。
export function bumpDraftRevision(tx: DbOrTx, albumId: string, current: number): Promise<number>;
```

- [ ] **Step 1: 写失败测试**(真库,isDbReachable skip)覆盖:有行相册 loadStoryDraft 读行并烘 html;`bake:false` 不烘;无行 + legacy pages 回退读且**不写库**;ensureDraftPagesSeeded 对 legacy 相册播种(行落库、revision=1)且幂等;两者皆无返回 null/现 revision;envelopeJson 不含 pages 键。

- [ ] **Step 2: 跑测试确认失败** — Run 同前;Expected: FAIL

- [ ] **Step 3: 实现** — envelope 解析复用 `readStoryDraft` 的既有分支逻辑(含裸树兼容):从 album-service 把纯解析部分抽到本文件,album-service 通过 re-export 保持既有 import 不断(`readStoryDraft`/`readPreviewPages` 的导出签名不变,内部实现在 Task 8/9 逐步切换)。

- [ ] **Step 4: 跑测试确认通过** — Run: 本文件测试 + `pnpm --filter @yujee/web typecheck`;Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/album/draft-store.ts apps/web/src/services/album/draft-store.test.ts apps/web/src/services/album/album-service.ts
git commit -m "feat(web): draft-store 存取层(行读 + 懒播种 + revision)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: updatePage 切行级写

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts`(`updatePage` :1317 一带)
- Test: `apps/web/src/services/album/album-service.test.ts`(现有 updatePage 用例必须原样全绿;新增行级断言)

**Interfaces:**
- Consumes: Task 1/2 全部
- Produces: `updatePage` 对外签名与行为不变;内部改为:行锁 → seeded → `loadStoryDraft({tx, bake:false})` 取目标页 → 既有 html patch 语义逐字保留(patch 失配 → html=null → `bakePageHtml` 重烘;imagePos 失败 `?? html` 保留)→ `bumpDraftRevision` → `draftPageRepo.updateOne(tx, albumId, pageIndex, patched, rev, userId)`。envelope 不重写(pages 不再进 draftJson)。COMPLETED→EDITING、pageIndex===0 清封面缩略图两个副作用保留。无 draft 相册(v1/v2)仍走 `albumPageRepo.updateOne` 分支,不动。

- [ ] **Step 1: 新增失败测试** — 行级断言:updatePage 后 `draftPageRepo.findByAlbum` 该行 version === album.draftRevision、updatedBy === userId、其他行 version 不变;legacy 相册(只有 draftJson.pages)首次 updatePage 自动播种全书行。
- [ ] **Step 2: 确认失败** → **Step 3: 实现** → **Step 4: updatePage 相关既有用例 + 新用例全绿 + typecheck** → **Step 5: Commit**(`feat(web): updatePage 切 draft_pages 行级写`,尾注同前)

---

### Task 4: reorderPages 切 replaceAll + pageCount 收口

**Files:**
- Modify: `album-service.ts`(`reorderPages` :1441 一带)
- Test: `album-service.test.ts`

**Interfaces:** 对外不变;内部:行锁 → seeded → 读行 → 双射/锚定页校验逻辑原样 → 置换后 `replaceAll(tx, albumId, permuted, rev, userId)` + **`pageCount: permuted.length` 一并更新**(收口点一)。html 逐字节不动的既有语义保留。

- [ ] **Step 1: 失败测试**(置换后行序/所有行 version==新 rev/pageCount 正确) → **Step 2-4: 红→实现→绿+typecheck** → **Step 5: Commit**(`feat(web): reorderPages 切 replaceAll,pageCount 收口`)

---

### Task 5: job 回调三写点加锁 + 切行级写

**Files:**
- Modify: `apps/web/src/services/job/job-service.ts`(`handleV3AnalyzeCompleted` append/主分支、`handleV3SelectLayoutCompleted`、`handleV3ComposeCompleted`)
- Test: `job-service.test.ts`、`job-service-append.test.ts`、`compose-completed.test.ts`(既有用例语义不变)

**Interfaces:** 每个回调事务补 `albumRepo.findByIdForUpdate`(修复现状无锁 + 事务外读改写窗口:读也挪进锁内);页写入走 `ensureDraftPagesSeeded` + `replaceAll`(select-layout 整替 / compose 整替)或 append 合并后 replaceAll;envelope(tree/progress/design)写 `draftJson`(经 `envelopeJson`,不含 pages);compose 的 `pageCount` 更新保留且 select-layout 也补上(收口点二)。job CAS(`transitionStatus`)幂等语义原样。

- [ ] **Step 1: 失败测试**(回调后行落库、draftJson 无 pages 键、旧用例断言迁移到行读) → **Step 2-4** → **Step 5: Commit**(`feat(web): 生成回调写点加行锁并切 draft_pages`)

---

### Task 6: persistDesignChat 切行级写 + pageBackground 契约修复

**Files:**
- Modify: `album-service.ts`(`persistDesignChat` :790)、`packages/contracts/src/v3.ts`(`V3StoryDraft.design`)、`apps/web/src/services/job/job-service.ts`(compose 写 design 处对齐新契约)
- Test: `album-service.test.ts`、`packages/contracts/src/v3.test.ts`

**Interfaces:** `persistDesignChat` 内部:行锁 → seeded → `Page.parse` 逐页(原样)→ `replaceAll(..., userId)` + **`pageCount` 收口(move_pages 增删页,收口点三)**;envelope 沿用锁内最新 tree/progress。契约:`design: z.object({ fonts, colors, pageBackground: z.string().optional() })`,消除 zod 往返丢字段;`job-service` 写点改为直接写进契约字段(去掉 spread hack)。

- [ ] **Step 1: 失败测试**(contracts:pageBackground 往返保留;web:persistDesignChat 后行 version 推进 + pageCount 跟随页数) → **Step 2-4**(contracts 测试单独跑 `pnpm --filter @yujee/contracts test`) → **Step 5: Commit**(`feat(web): persistDesignChat 切行级写;design.pageBackground 进契约`)

---

### Task 7: saveChapterContexts / markChapterDone 摘除 pages 搬运

**Files:**
- Modify: `album-service.ts`(`saveChapterContexts` :848、`markChapterDone` :666)
- Test: `album-service.test.ts`

**Interfaces:** 两方法只写 envelope(tree/progress),**不再读写 pages**;`saveChapterContexts` 补行锁(修复现状无锁+事务外读)。draft_revision 不推进(页没变——Phase 1b 的 collab-sync 只关心页变化)。

- [ ] **Step 1: 失败测试**(保存章节上下文后 draft_pages 行的 version/内容完全不动;并发页写不再被章节保存覆盖——用先 updatePage 后 saveChapterContexts 的顺序断言页改动幸存) → **Step 2-4** → **Step 5: Commit**(`fix(web): 章节写点不再搬运 pages,补行锁`)

---

### Task 8: 读路径切换批 A(编辑器面)

**Files:**
- Modify: `album-service.ts`:`getDraftSkeleton`(:934)、`getChapterSummary`(:525)、`getStoryProgress`(:653)、`getInternalAgentData`(:542)、`prepareDesignChat`(:756,含 :765 裸读 design 改走 envelope)
- Test: `album-service.test.ts` 相关用例

**Interfaces:** 全部改经 `loadStoryDraft(album)`(默认 bake);对外响应形状逐字段不变(投影逻辑原样搬)。`getDraftSkeleton` 门禁(status/layoutJson 判定)原样。

- [ ] **Step 1: 既有用例做守卫(先跑绿基线)** → **Step 2: 切换实现** → **Step 3: 相关用例全绿 + typecheck** → **Step 4: Commit**(`refactor(web): 编辑器读路径切 loadStoryDraft`)

---

### Task 9: 读路径切换批 B(share/封面/生成面)

**Files:**
- Modify: `share-service.ts`(:56 冻结读,`bake:false`)、`album-service.ts`:`coverThumbnailRevision`(:65)、`assertStoryExportUnlocked`(:387)、`fallbackCoverPhotoIds`(:1035)、`listCoverSets`(:1127)、`applyDesign`(:1151)、`delete`(补 `draftPageRepo.deleteByAlbum`);`generation-service.ts`(:105 `submitAddPhotosV3`、`readDraftTree` 两处)
- Test: `share-service.test.ts`、`album-export-flow.test.ts`、`apply-design-failures.test.ts`、`design-apply.test.ts`、`generation-service.test.ts`、`append-photos.test.ts`

**Interfaces:** share 冻结在其行锁事务内 `loadStoryDraft(album, {tx, bake:false})`(**保持不烘现状**);封面 revision 读第 0 页改行读(在其行锁内);`fallbackCoverPhotoIds`/`listCoverSets`/`applyDesign` 的裸对象读改为 `loadStoryDraft`(bake:false,拿 pages 与 tree);generation 的 `readDraftTree` 只读 envelope 不需 pages 的保持只解 envelope。`delete` 级联补 draft_pages(与 album_photos 同款)。

- [ ] **Step 1: 既有用例绿基线** → **Step 2: 切换** → **Step 3: 全部相关测试绿 + typecheck** → **Step 4: Commit**(`refactor(web): share/封面/生成读路径切 loadStoryDraft`)

---

### Task 10: 写点清扫 + 回归守卫

**Files:**
- Modify: `album-service.ts` / `job-service.ts` 残余(`buildAnalyzeDraftJson` 等所有 draftJson 构造点确认只产 envelope)
- Test: Create `apps/web/src/services/album/draft-pages-guard.test.ts`

**Interfaces:** 守卫测试两条:① grep 源码断言(读取 service 源文件字符串)`draftJson` 的写点不再出现 `pages:`(白名单 draft-store 的 legacy 回退读);② 真库端到端:analyze→select-layout→updatePage→design-chat→share 全链走一遍后,`albums.draftJson` 无 `pages` 键、`draft_pages` 行数 === pageCount === 实际页数、每步 revision 严格递增。

- [ ] **Step 1: 写守卫测试跑红(若有漏点)** → **Step 2: 清扫直至绿** → **Step 3: typecheck** → **Step 4: Commit**(`test(web): draft_pages 拆表回归守卫`)

---

### Task 11: 文档 + 全量验证

**Files:**
- Modify: `README.md`(设计边界「页面真相」条目)、`CLAUDE.md`(页面真相节)、`apps/web/README.md`(Database Boundary + Page HTML Truth 节)+ 三处 doc-scope checked-at

**要点:** 页面真相仍是 HTML,但 draft 页的持久化载体从 `albums.draft_json.pages` 改为 `draft_pages` 行(`version`/`updatedBy`/`draft_revision` 为 Phase 1b 预留);`draftJson` 只剩 envelope;`album_pages` 仍为 v1/v2 遗留。验证阶梯(逐条,红了先修):

```bash
pnpm --filter @yujee/web test
pnpm --filter @yujee/contracts test
pnpm typecheck   # 含 docs:check
```

- [ ] **Step 1: 改写三份文档** → **Step 2: 验证阶梯全绿**(docs:check 若因用户并行提交报其他文档,按 Phase 0 Task 9 的同款规程处置:不代人核对) → **Step 3: Commit**(`docs: draft_pages 拆表后的页面真相边界改写`)

---

## 并行分组(subagent 分摊参考;执行仍串行分派)

- 第一波:Task 1 → Task 2(强依赖链,串行)
- 第二波:Task 3、4、5、6、7(都依赖 1+2,彼此改同一个 album-service/job-service,**必须串行**)
- 第三波:Task 8 → 9(同文件,串行)
- 收尾:Task 10 → 11

## Self-Review 结论(计划作者自查)

- **规格覆盖**:spec Phase 1「draft_pages 拆表」段 → T1(表/version/updatedBy)+ T3(保存协议的行级载体;CAS/锁本身属 1b);「readStoryDraft、组页落库、design-chat 回放、分享冻结这些读写路径全部切到 draft_pages」→ T3-T9 逐点映射,写点清单来自侦察报告的 9 写点(#1-#4→T5,#5→T7,#6→T6,#7→T7,#8→T3,#9→T4),读点清单全部落在 T8/T9。四个顺手修复(无锁回调/章节搬运/pageCount/pageBackground)在 Architecture 声明并分task落实。
- **类型一致**:`draftPageRepo` 签名在 T1 定义、T2-T10 逐字消费;`loadStoryDraft`/`ensureDraftPagesSeeded` 在 T2 定义;`version` 取值 = 写入时的新 `draft_revision`,T3/T4/T5/T6 一致执行;`updatedBy` 用户写点传 userId、系统/agent 写点传 null(T5)与 design-chat 传发起人(T6)。
- **已知取舍**:① revision 用 albums 列而非独立序列,写事务里天然持锁无竞争;② `saveChapterContexts` 不推 revision(页没变),1b 的 collab-sync 以页变化为准;③ 守卫测试用源码 grep 属于弱形式,但配合端到端断言足够;④ 桌面/移动编辑器**零改动**(保存端点与响应形状不变),Phase 1b 才引入 expectedVersion 与 409 UI。
