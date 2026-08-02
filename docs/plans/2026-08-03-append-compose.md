# 追加范围成稿(加图后给新页写文案)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已设计的书追加照片后,增量排版落地即自动派发一次「只写新章」的 `/v3/compose`,新页拿到 Gemini 文案;老页与用户手改一字不动。

**Architecture:** 复用现有 compose 全链路,只收窄范围:Web 侧新增 `composeAppend` 派发(空 coverSlots/endingSlots、只送新章),engine 侧全局批次(封面/封尾/字体)在两个槽列表全空时直接跳过,回调侧按 `meta.composeAppend` 走「只合并 pagesTexts + 重烘目标页」的缩小版落库。前端在追加排版收尾处接上派发与轮询。

**Tech Stack:** Next.js(apps/web)+ FastAPI(engine)+ node:test / pytest。

**根因回顾:** `/v3/compose` 全仓唯一派发点是 `applyDesign`(选封面组),#305(2026-07-23)砍旧 workflow 时丢了 append 路径挂在 judge 收尾的 write_copy,没重新接线;已设计的书 `designed===true` 封面卡不再弹,追加后永远没有第二次 compose。`d6ec5bbb`(坏 JSON 修复)修的是另一根因,对此症状无效。

## Global Constraints

- **零契约改动**:`ComposeRequest.coverTemplateId/coverSlots/endingSlots` 已有空默认值,`ComposeCompleted` 各块已有 `.default({})` —— 两端 schema 一律不动,只收窄用法。
- **失败绝不阻断交付**:文案写不出 → 新页保留模板 sample + 诚实回执;绝不把整次追加打成 failed(与 compose 既有硬约束同款)。
- **不整本重 compose**:老页文案、用户用设计 Agent 手改过的内容,一个槽都不能动。
- **隐私**:refs(200px base64)只在请求内存里,不落盘、不进日志(§数据归属既有口径)。
- **验证陷阱**(仓根 CLAUDE.md):`pnpm test` 撞第一个失败的包就中断;`pnpm typecheck` 不含 engine;engine 测试 `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests`;web 单跑 `cd apps/web && pnpm test`。
- **落点**:按仓惯例直接落 main。桌面主 checkout 正被 feat/collab-editing 占用且有脏文件 —— 用 `git worktree add ../wt-append-compose main` 隔离开发,完成后 push main(CI 自动部署 web + engine)。

## 数据流(改完之后)

```text
加照片 → analyze(确定性分章) → 采访新章 → select-layout(chapterIds 增量)
  → 回调合并新页(sample 文案 + 继承设计 carrier)              【现状已有】
  → 前端确认排版落地 → 若书已设计:POST /compose-append          【本计划新增】
      → engine /v3/compose(只送新章、空 cover/ending → 跳过全局批次)
      → 回调 meta.composeAppend 分支:pagesTexts 合进目标页 + 重烘 html
      → 前端轮询 GET /design 的 lastComposeStatus → 刷画板 + 回执
  → 若书未设计:保持现状(新页文案等选封面时随全书成稿一起写)
```

已知可接受的窗口:compose-append 在跑的几十秒里,用户若同时在对话里手改**新页**文案,回调会覆盖那几个槽(全书成稿同款竞态,不另做锁)。

---

### Task 1: engine —— 空封面/封尾槽时跳过全局批次

**Files:**
- Modify: `engine/src/workflows/compose.py`(`global_task`,约 187 行)
- Test: `engine/tests/test_compose.py`(文件尾追加)

**Interfaces:**
- Produces: `/v3/compose` 收到 `coverSlots=[] && endingSlots=[]` 时,回调的 `coverTexts/endingTexts/fonts` 全空,全局批次零 Gemini 调用。Web 侧(Task 3)依赖这一行为派发追加范围成稿。

- [ ] **Step 1: 写失败测试**(追加到 `engine/tests/test_compose.py` 尾部)

```python
def test_追加范围成稿_无封面封尾槽时全局批次不调_gemini(monkeypatch):
    """coverSlots/endingSlots 全空(追加范围成稿):全局批次直接跳过 ——
    不调 Gemini,coverTexts/endingTexts/fonts 全空;章节批次照常写。"""
    from src.workflows import compose as compose_flow
    from src.workflows.core import compose as compose_agent

    _set_key(monkeypatch)

    async def fake_chapter(chapter, *, language):
        return compose_agent.ComposeChapterResult(
            pages_texts={0: {"title": "新章标题"}}, call_count=1
        )

    async def fake_global(**kwargs):
        raise AssertionError("no cover/ending slots -> global batch must be skipped")

    posted: list = []

    async def fake_post(url, envelope):
        posted.append(envelope)

    monkeypatch.setattr(compose_agent, "compose_chapter", fake_chapter)
    monkeypatch.setattr(compose_agent, "compose_global", fake_global)
    monkeypatch.setattr(compose_flow.callback, "post", fake_post)

    req = compose_flow.ComposeRequest.model_validate(
        {
            "requestId": "req-append",
            "callbackUrl": "http://web.test/cb",
            "language": "zh",
            "chapters": [_CHAPTER],
        }
    )
    asyncio.run(compose_flow._run_compose(compose_flow._Job(req)))

    completed = next(e for e in posted if getattr(e, "event", "") == "completed")
    assert completed.pagesTexts == {0: {"title": "新章标题"}}
    assert completed.coverTexts == {}
    assert completed.endingTexts == {}
    assert completed.fonts == {}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_compose.py -k 无封面封尾 -v`
Expected: FAIL(AssertionError: global batch must be skipped)

- [ ] **Step 3: 最小实现** —— `compose.py` 的 `global_task` 开头加短路:

```python
    async def global_task():
        # 追加范围成稿(只写新章):没有封面/封尾槽就没有全局批次的活 ——
        # 不调 Gemini、不回封面/字体(Web 追加合并侧只消费 pagesTexts)。
        if not req.coverSlots and not req.endingSlots:
            return compose_agent.ComposeGlobalResult()
        try:
            return await _global_task_inner()
        except Exception as exc:  # noqa: BLE001 — 全局批次也不许阻断交付
            log.warning("v3_compose.global_dropped", error=str(exc))
            return compose_agent.ComposeGlobalResult()
```

- [ ] **Step 4: 跑测试确认通过 + 全量 compose 测试不倒**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_compose.py -v`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/workflows/compose.py engine/tests/test_compose.py
git commit -m "feat(engine): compose 空封面/封尾槽跳过全局批次 —— 为追加范围成稿铺路"
```

---

### Task 2: web 纯函数层 —— readComposeAppendMeta + mergeAppendComposeTexts

**Files:**
- Modify: `apps/web/src/services/job/job-service.ts`(紧挨 `readComposeMeta`/`mergeComposeIntoDraft`)
- Test: Create `apps/web/src/services/job/compose-append.test.ts`

**Interfaces:**
- Produces:
  - `type ComposeAppendJobMeta = { language: 'zh' | 'en'; chapterIds: string[] }`
  - `readComposeAppendMeta(meta: unknown): ComposeAppendJobMeta | null` —— 只认 `{ composeAppend: { chapterIds: 非空 string[] } }`
  - `mergeAppendComposeTexts(draftJson: unknown, pagesTexts: ComposeCompletedPayload['pagesTexts']): { draftJson: Record<string, unknown>; writtenPageIndexes: number[] }`
- Consumes: 既有 `applyComposePagesTexts` / `bakePagesHtml` / `V3StoryDraft`。

- [ ] **Step 1: 写失败测试**(draft 帮手对齐 `job-service-append.test.ts` 的 `pagedDraft` 形状 —— 章节节点带 photos/orientation 等 V3StoryDraft 必填字段,内页模板从 `TEMPLATES` 里挑 category='interior' 且有 title+body 槽的)

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { mergeAppendComposeTexts, readComposeAppendMeta } from './job-service';

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const interior = (Object.values(TEMPLATES) as TemplateInfo[]).find(
  (t) =>
    t.category === 'interior' &&
    (t.texts ?? []).some((s) => s.role === 'title') &&
    (t.texts ?? []).some((s) => s.role === 'body'),
)!;
const titleSlot = interior.texts!.find((s) => s.role === 'title')!.id;
const bodySlot = interior.texts!.find((s) => s.role === 'body')!.id;

function chapterNode(chapterId: string) {
  return {
    chapterId,
    description: '',
    chapterContext: '',
    accentColor: null,
    artFont: null,
    photos: [
      { photoId: `${chapterId}-p`, sceneDescription: '', width: 800, height: 600, orientation: 'landscape' as const },
    ],
  };
}

function pagedDraft(pages: Page[]) {
  return {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1')] },
    pages,
    progress: { currentChapterId: null, doneChapterIds: ['c1'] },
  };
}

const PAGES: Page[] = [
  { pageIndex: 0, templateId: interior.id, images: {}, texts: { [titleSlot]: 'OLD TITLE', [bodySlot]: 'OLD BODY' } },
  { pageIndex: 1, templateId: interior.id, images: {}, texts: { [titleSlot]: 'KEEP TITLE', [bodySlot]: 'KEEP BODY' } },
];

test('readComposeAppendMeta: 只认 { composeAppend: { chapterIds: 非空 string[] } }', () => {
  assert.equal(readComposeAppendMeta(null), null);
  assert.equal(readComposeAppendMeta({ compose: { coverTemplateId: 'x', endingTemplateId: 'y' } }), null);
  assert.equal(readComposeAppendMeta({ composeAppend: { chapterIds: [] } }), null);
  assert.deepEqual(readComposeAppendMeta({ composeAppend: { language: 'zh', chapterIds: ['a1'] } }), {
    language: 'zh',
    chapterIds: ['a1'],
  });
});

test('mergeAppendComposeTexts: 逐槽覆盖目标页并重烘 html,其余页原样', () => {
  const { draftJson, writtenPageIndexes } = mergeAppendComposeTexts(pagedDraft(PAGES), {
    '0': { [titleSlot]: '新标题', [bodySlot]: '新正文' },
  });
  const pages = (draftJson as { pages: Page[] }).pages;
  assert.deepEqual(writtenPageIndexes, [0]);
  assert.equal(pages[0]!.texts[titleSlot], '新标题');
  assert.ok(pages[0]!.html?.includes('新标题'));       // 目标页重烘
  assert.deepEqual(pages[1]!.texts, PAGES[1]!.texts);  // 没写的页原样
  assert.equal(pages[1]!.html, PAGES[1]!.html);        // 也不重烘
});

test('mergeAppendComposeTexts: 模型没写的槽保留原值(mergeSlotTexts 口径)', () => {
  const { draftJson } = mergeAppendComposeTexts(pagedDraft(PAGES), {
    '0': { [titleSlot]: '只写了标题' },
  });
  const pages = (draftJson as { pages: Page[] }).pages;
  assert.equal(pages[0]!.texts[bodySlot], 'OLD BODY');
});

test('mergeAppendComposeTexts: pagesTexts 空 → 页面原样,writtenPageIndexes 空', () => {
  const { draftJson, writtenPageIndexes } = mergeAppendComposeTexts(pagedDraft(PAGES), {});
  assert.deepEqual(writtenPageIndexes, []);
  assert.deepEqual((draftJson as { pages: Page[] }).pages, PAGES);
});

test('mergeAppendComposeTexts: 无页草稿直接抛(时序错了要诚实失败)', () => {
  assert.throws(() => mergeAppendComposeTexts({ version: 'v3-story', tree: { chapters: [chapterNode('c1')] }, pages: [], progress: { currentChapterId: null, doneChapterIds: [] } }, {}));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test -- src/services/job/compose-append.test.ts`
Expected: FAIL(mergeAppendComposeTexts is not exported)

- [ ] **Step 3: 实现**(job-service.ts,放在 `readComposeMeta` 之后)

```ts
// 追加范围成稿 job 的派发快照(agent_jobs.meta.composeAppend):只写这些章的内页文案,
// 不碰封面/封尾/字体/stage。与全书成稿共用 kind='compose'(活跃唯一索引天然互斥)。
export type ComposeAppendJobMeta = { language: 'zh' | 'en'; chapterIds: string[] };

export function readComposeAppendMeta(meta: unknown): ComposeAppendJobMeta | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const raw = (meta as { composeAppend?: unknown }).composeAppend;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const ids = Array.isArray(value.chapterIds)
    ? (value.chapterIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  if (ids.length === 0) return null;
  return { language: value.language === 'zh' ? 'zh' : 'en', chapterIds: ids };
}

// 追加范围成稿落回 draft(纯函数):pagesTexts 逐槽合进对应页 + 只重烘这些页的 html。
// 设计三件套/封面封尾/progress/stage 一概不动 —— mergeComposeIntoDraft 的缩小版。
export function mergeAppendComposeTexts(
  draftJson: unknown,
  pagesTexts: ComposeCompletedPayload['pagesTexts'],
): { draftJson: Record<string, unknown>; writtenPageIndexes: number[] } {
  const parsed = V3StoryDraft.safeParse(draftJson);
  if (!parsed.success || !parsed.data.pages || parsed.data.pages.length === 0) {
    throw ERRORS.VALIDATION_FAILED('append compose completion requires an existing paged draft');
  }
  const written = new Set(Object.keys(pagesTexts ?? {}).map(Number));
  const merged = applyComposePagesTexts(parsed.data.pages, pagesTexts);
  const touched = merged.filter((page) => written.has(page.pageIndex));
  const baked = bakePagesHtml(touched.map((page) => ({ ...page, html: undefined }))) as Page[];
  const bakedByIndex = new Map(baked.map((page) => [page.pageIndex, page]));
  const pages = merged.map((page) => bakedByIndex.get(page.pageIndex) ?? page);
  return {
    draftJson: { ...parsed.data, pages },
    writtenPageIndexes: touched.map((page) => page.pageIndex).sort((a, b) => a - b),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test -- src/services/job/compose-append.test.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/job/job-service.ts apps/web/src/services/job/compose-append.test.ts
git commit -m "feat(web): 追加范围成稿纯函数层 —— composeAppend meta 读取 + 目标页合并重烘"
```

---

### Task 3: web 服务 + 路由 —— composeAppend 派发

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts`(`applyDesign` 之后;imports 补 `extractDesignFromPages` from `./append-photos`)
- Create: `apps/web/src/app/api/v3/albums/[uuid]/compose-append/route.ts`
- Test: Create `apps/web/src/services/album/compose-append-flow.test.ts`

**Interfaces:**
- Produces: `albumService.composeAppend(userId, albumId, { language, chapterIds, refs? }) → { accepted: true; composed: boolean; requestId?: string }`;`POST /api/v3/albums/[uuid]/compose-append`。
- Consumes: Task 2 的 meta 形状 `{ composeAppend: { language, chapterIds } }`;既有 `buildComposeRequest`(coverTemplateId `''` → `slotSpecs('')` 返回 `[]`,天然得到空槽请求)。

- [ ] **Step 1: 写失败测试**(DB 直连口径,参照 `compose-completed.test.ts` 的 makeUser/makeAlbum/isDbReachable 用法;agentClient 用 `node:test` 的 `mock.method` 拦)

```ts
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { TEMPLATES } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { db } from '../../db/client';
import { albumRepo } from '../../db/repos/album-repo';
import { agentJobRepo } from '../../db/repos/agent-job-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { agentClient } from '@/lib/agent/agent-client';
import { albumService } from './album-service';
import { sweepCarriers } from './design-apply';
import { readComposeAppendMeta } from '../job/job-service';

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const interior = (Object.values(TEMPLATES) as TemplateInfo[]).find(
  (t) => t.category === 'interior' && (t.texts ?? []).some((s) => s.role === 'title'),
)!;
const FONTS = { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' };
const COLORS = { title: '#111111', body: '#222222', explain: '#333333' };

function chapterNode(chapterId: string, photoId: string) {
  return {
    chapterId,
    description: '',
    chapterContext: '追加章的采访原话',
    accentColor: null,
    artFont: null,
    photos: [{ photoId, sceneDescription: '', width: 800, height: 600, orientation: 'landscape' as const }],
  };
}

// 已设计的书:两章,addx-c1 是追加章,其页已增量排版落地(images 引用追加照片)。
function designedDraft() {
  const pages: Page[] = sweepCarriers(
    [
      { pageIndex: 0, templateId: interior.id, images: { image: 'p-old' }, texts: {} },
      { pageIndex: 1, templateId: interior.id, images: { image: 'p-new' }, texts: {} },
    ],
    FONTS,
    COLORS,
  );
  return {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1', 'p-old'), chapterNode('addx-c1', 'p-new')] },
    pages,
    progress: { currentChapterId: null, doneChapterIds: ['c1', 'addx-c1'] },
  };
}

test('composeAppend', { skip: !(await isDbReachable()) }, async (t) => {
  const user = await makeUser('compose-append');
  t.after(async () => cleanupUser(user.id));

  await t.test('已设计:建 kind=compose job(meta.composeAppend)并转发只含新章的空槽请求', async () => {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: designedDraft() });
    const submit = mock.method(agentClient, 'submitComposeV3', async () => ({ requestId: 'r' }));

    const res = await albumService.composeAppend(user.id, album.id, {
      language: 'zh',
      chapterIds: ['addx-c1'],
      refs: { 'p-new': 'data:image/jpeg;base64,AAAA' },
    });

    assert.equal(res.composed, true);
    const payload = submit.mock.calls[0]!.arguments[0]!;
    assert.deepEqual(payload.chapters.map((c: { chapterId: string }) => c.chapterId), ['addx-c1']);
    assert.equal(payload.coverSlots.length, 0);
    assert.equal(payload.endingSlots.length, 0);
    const job = await agentJobRepo.findByRequestId(res.requestId!);
    assert.equal(job?.kind, 'compose');
    assert.deepEqual(readComposeAppendMeta(job?.meta), { language: 'zh', chapterIds: ['addx-c1'] });
    submit.mock.restore();
  });

  await t.test('未设计(无 carrier):composed:false,不建 job 不调 agent', async () => {
    const album = await makeAlbum(user.id);
    const draft = designedDraft();
    // 洗掉 carrier:回到未设计形态
    draft.pages = draft.pages.map((p) => ({ ...p, texts: {} }));
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: draft });
    const submit = mock.method(agentClient, 'submitComposeV3', async () => ({ requestId: 'r' }));
    const res = await albumService.composeAppend(user.id, album.id, { language: 'zh', chapterIds: ['addx-c1'] });
    assert.equal(res.composed, false);
    assert.equal(submit.mock.callCount(), 0);
    submit.mock.restore();
  });

  await t.test('未知 chapterId → VALIDATION_FAILED', async () => {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: designedDraft() });
    await assert.rejects(
      albumService.composeAppend(user.id, album.id, { language: 'zh', chapterIds: ['ghost'] }),
      /VALIDATION_FAILED/,
    );
  });

  await t.test('章里没有已排版页 → VALIDATION_FAILED(时序防错)', async () => {
    const album = await makeAlbum(user.id);
    const draft = designedDraft();
    draft.pages = draft.pages.filter((p) => p.images.image !== 'p-new'); // 追加章的页还没合并
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: draft });
    await assert.rejects(
      albumService.composeAppend(user.id, album.id, { language: 'zh', chapterIds: ['addx-c1'] }),
      /VALIDATION_FAILED/,
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test -- src/services/album/compose-append-flow.test.ts`
Expected: FAIL(composeAppend is not a function)

- [ ] **Step 3: 实现服务**(album-service.ts,`applyDesign` 之后)

```ts
  // 追加范围成稿:加图增量排版落地后,只为这些章的内页写文案(engine /v3/compose,
  // 空 coverSlots/endingSlots → engine 跳过全局批次:不写封面、不回字体)。已设计的书
  // 专用 —— 未设计的书返回 composed:false,新页等用户选封面时随全书成稿一起写。
  // 幂等:与全书成稿共用 (album,'compose') 活跃唯一索引,在途成稿只有一单。
  async composeAppend(
    userId: string,
    albumId: string,
    input: { language: 'zh' | 'en'; chapterIds: string[]; refs?: Record<string, string> },
  ): Promise<{ accepted: true; composed: boolean; requestId?: string }> {
    const album = await this.findOwned(userId, albumId);
    if (album.status !== 'EDITING' || album.layoutJson != null) throw ERRORS.ALBUM_NOT_EDITABLE();

    const root = album.draftJson as { tree?: { chapters?: unknown }; pages?: unknown } | null;
    const rawPages = Array.isArray(root?.pages) ? (root!.pages as Page[]) : [];
    if (rawPages.length === 0) throw ERRORS.VALIDATION_FAILED('append compose requires laid-out pages');
    // 设计三键提取不到 = 书没设计过:不派发,新页文案等全书成稿(选封面)一起写。
    if (!extractDesignFromPages(rawPages)) return { accepted: true, composed: false };

    const chapters = Array.isArray((root?.tree as { chapters?: unknown })?.chapters)
      ? ((root!.tree as { chapters: unknown[] }).chapters as Array<{
          chapterId?: string;
          title?: string;
          chapterContext?: string;
          place?: string;
          photos?: Array<{ photoId: string; takenAt?: string | null }>;
        }>)
      : [];
    const scope = new Set(input.chapterIds);
    const scoped = chapters.filter((c) => c.chapterId && scope.has(c.chapterId));
    if (scoped.length !== scope.size) {
      throw ERRORS.VALIDATION_FAILED('unknown chapterId in append compose scope');
    }

    const interiorPages = rawPages.filter((page) => templateCategory(page.templateId) === 'interior');
    const requestId = crypto.randomUUID();
    const payload = buildComposeRequest({
      requestId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      albumTitle: (album.title ?? '').slice(0, 120),
      coverTemplateId: '',
      endingTemplateId: '',
      chapters: scoped,
      interiorPages,
      refs: input.refs ?? {},
    });
    // 范围里的章必须真有页可写(增量排版已合并);全空 = 调用时序错了,诚实拒绝。
    if (payload.chapters.every((c) => c.pages.length === 0)) {
      throw ERRORS.VALIDATION_FAILED('append compose scope has no laid-out pages');
    }

    try {
      await db.transaction(async (tx) => {
        const created = await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId,
          kind: 'compose',
          meta: { composeAppend: { language: input.language, chapterIds: input.chapterIds } },
        });
        await jobService.markRunning(tx, created.id);
      });
    } catch (e) {
      // 唯一索引冲突 = 已有在途成稿(全书或追加):幂等接受,不起第二单。
      if (!isUniqueViolation(e)) {
        logger.error({ err: String(e), requestId, albumId }, 'create append compose job failed');
        throw e;
      }
      return { accepted: true, composed: true };
    }

    try {
      await agentClient.submitComposeV3(payload);
    } catch (e) {
      logger.error({ err: String(e), requestId, albumId }, 'agent v3 append compose submit failed');
      await jobService.handleV3Failed(requestId, {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'Failed to submit append compose to agent',
      });
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }

    return { accepted: true, composed: true, requestId };
  },
```

- [ ] **Step 4: 路由薄壳**(新文件 `compose-append/route.ts`,对齐 `design/route.ts` 风格)

```ts
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 追加范围成稿:加图增量排版落地后,只为新章内页写文案(异步派发 engine /v3/compose,
// 空 cover/ending 槽 → 不写封面不动字体)。composed:false = 书未设计,等选封面全书成稿。
export const maxDuration = 60;

const BodySchema = z
  .object({
    language: z.enum(['zh', 'en']),
    chapterIds: z.array(z.string().min(1)).min(1).max(50),
    // 200px 缩略图(photoId → data URL):模型看真实照片写文案,原图只在浏览器。
    refs: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.composeAppend(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/web && pnpm test -- src/services/album/compose-append-flow.test.ts`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/album/album-service.ts apps/web/src/services/album/compose-append-flow.test.ts "apps/web/src/app/api/v3/albums/[uuid]/compose-append/route.ts"
git commit -m "feat(web): composeAppend 服务与路由 —— 只送新章的空槽 compose 派发"
```

---

### Task 4: web 回调 —— handleV3ComposeCompleted 追加分支

**Files:**
- Modify: `apps/web/src/services/job/job-service.ts`(`handleV3ComposeCompleted`,约 496 行)
- Test: Modify `apps/web/src/services/job/compose-append.test.ts`(追加 DB 集成测试;imports 补 setup 帮手)

**Interfaces:**
- Consumes: Task 2 的 `readComposeAppendMeta` / `mergeAppendComposeTexts`。
- Produces: `meta.composeAppend` 的 compose job 完成时只合并目标页文案,stage/pageCount/design 不动,写一条 assistant 回执。

- [ ] **Step 1: 写失败测试**(追加到 compose-append.test.ts;makeAlbum 后设 EDITING + stage 'ready' + designedDraft 同 Task 3 形状,再走 `jobService.createGenerationJob(kind:'compose', meta:{composeAppend:...})` → `handleV3ComposeCompleted`)

```ts
test('追加范围成稿回调', { skip: !(await isDbReachable()) }, async (t) => {
  const user = await makeUser('append-compose-cb');
  t.after(async () => cleanupUser(user.id));

  await t.test('只写目标页,stage 与老页不动,assistant 回执落一条', async () => {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'ready', draftJson: designedDraft() });
    const requestId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const job = await jobService.createGenerationJob(tx, {
        userId: user.id, albumId: album.id, requestId, kind: 'compose',
        meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
      });
      await jobService.markRunning(tx, job.id);
    });

    await jobService.handleV3ComposeCompleted(requestId, { pagesTexts: { '1': { [titleSlot]: '追加页新标题' } } }, null);

    const after = await albumRepo.findById(album.id);
    const pages = (after!.draftJson as { pages: Page[] }).pages;
    assert.equal(pages[1]!.texts[titleSlot], '追加页新标题');
    assert.ok(pages[1]!.html?.includes('追加页新标题'));
    assert.equal(after!.stage, 'ready');                       // 不动
    assert.equal((await agentJobRepo.findByRequestId(requestId))!.status, 'COMPLETED');
    const messages = await albumMessageRepo.listByAlbum(db, album.id);
    assert.ok(messages.some((m) => m.role === 'assistant' && m.content.includes('新照片的文案写好了')));
  });

  await t.test('pagesTexts 全空(章全掉队):job 照常 COMPLETED,回执诚实', async () => {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'ready', draftJson: designedDraft() });
    const requestId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const job = await jobService.createGenerationJob(tx, {
        userId: user.id, albumId: album.id, requestId, kind: 'compose',
        meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
      });
      await jobService.markRunning(tx, job.id);
    });
    await jobService.handleV3ComposeCompleted(requestId, { pagesTexts: {} }, null);
    assert.equal((await agentJobRepo.findByRequestId(requestId))!.status, 'COMPLETED');
    const messages = await albumMessageRepo.listByAlbum(db, album.id);
    assert.ok(messages.some((m) => m.role === 'assistant' && m.content.includes('没写出来')));
  });
});
```

(`albumMessageRepo.listByAlbum` 若签名不同,以 `apps/web/src/db/repos/album-message-repo.ts` 实际读接口为准调整断言取数方式。)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test -- src/services/job/compose-append.test.ts`
Expected: 新增两条 FAIL(现在走的是「compose job has no cover-set meta」→ job 被打成 FAILED)

- [ ] **Step 3: 实现** —— `handleV3ComposeCompleted` 里,取 album 之后、`readComposeMeta` 之前插入:

```ts
    // 追加范围成稿(meta.composeAppend):只合并目标页文案 + 重烘,其余一概不动。
    const appendMeta = readComposeAppendMeta(job.meta);
    if (appendMeta) {
      let merged: ReturnType<typeof mergeAppendComposeTexts>;
      try {
        merged = mergeAppendComposeTexts(album.draftJson, payload.pagesTexts);
      } catch (e) {
        logger.error(
          { err: String(e), requestId, albumId: job.albumId },
          'append compose completed but merge failed',
        );
        await this.handleV3Failed(requestId, {
          code: 'AGENT_INVALID_OUTPUT',
          message: 'append compose result could not be applied to the draft',
        });
        return;
      }
      await db.transaction(async (tx) => {
        const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
          progress: 100,
          stage: 'wrap',
          usage: (usage as Record<string, unknown> | null) ?? null,
          completedAt: new Date(),
        });
        if (!won) return;
        await albumRepo.update(tx, job.albumId, { draftJson: merged.draftJson });
        // 回执只在真处理后写;文案没写出来也要诚实说(设计对话可补写,不留假成功)。
        await albumMessageRepo.create(tx, {
          albumId: job.albumId,
          userId: job.userId,
          role: 'assistant',
          content:
            merged.writtenPageIndexes.length > 0
              ? (appendMeta.language === 'zh'
                  ? '新照片的文案写好了,和全书一个声音。不合口味随时在对话里改。'
                  : 'The new pages now have their copy, in the same voice as the rest of the book. Ask me here to tweak anything.')
              : (appendMeta.language === 'zh'
                  ? '新照片排进书里了,但这次文案没写出来。在对话里跟我说「给新页写文案」,我来补。'
                  : "The new photos are in, but their copy didn't come through this time. Tell me here to write it and I'll fill them in."),
        });
      });
      return;
    }
```

- [ ] **Step 4: 跑测试确认通过 + 既有 compose 回调测试不倒**

Run: `cd apps/web && pnpm test -- src/services/job/compose-append.test.ts src/services/job/compose-completed.test.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/job/job-service.ts apps/web/src/services/job/compose-append.test.ts
git commit -m "feat(web): compose 回调追加分支 —— 只合并新页文案,stage/封面/字体不动"
```

---

### Task 5: GET /design 带 lastComposeStatus(前端完成信号)

**Files:**
- Modify: `apps/web/src/db/repos/agent-job-repo.ts`(`findActiveComposeByAlbum` 旁)
- Modify: `apps/web/src/services/album/album-service.ts`(`listCoverSets`,约 1121 行)
- Test: Modify `apps/web/src/services/album/compose-append-flow.test.ts`

**Interfaces:**
- Produces: `GET /api/v3/albums/[uuid]/design` 响应新增 `lastComposeStatus: 'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|null`;`composing` 语义不变(向后兼容)。repo 新增 `findLatestComposeByAlbum(albumId)`。

- [ ] **Step 1: 写失败测试**(追加到 compose-append-flow.test.ts)

```ts
  await t.test('listCoverSets: 最近一单 compose 的状态透出为 lastComposeStatus', async () => {
    const album = await makeAlbum(user.id);
    await albumRepo.update(db, album.id, { status: 'EDITING', draftJson: designedDraft() });
    const requestId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const job = await jobService.createGenerationJob(tx, {
        userId: user.id, albumId: album.id, requestId, kind: 'compose',
        meta: { composeAppend: { language: 'zh', chapterIds: ['addx-c1'] } },
      });
      await jobService.markRunning(tx, job.id);
    });
    let state = await albumService.listCoverSets(user.id, album.id);
    assert.equal(state.composing, true);
    assert.equal(state.lastComposeStatus, 'RUNNING');

    await jobService.handleV3ComposeCompleted(requestId, { pagesTexts: {} }, null);
    state = await albumService.listCoverSets(user.id, album.id);
    assert.equal(state.composing, false);
    assert.equal(state.lastComposeStatus, 'COMPLETED');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && pnpm test -- src/services/album/compose-append-flow.test.ts`
Expected: FAIL(lastComposeStatus undefined)

- [ ] **Step 3: 实现** —— repo 加一查(与 `findActiveComposeByAlbum` 同款、去掉 status 过滤):

```ts
  // 最近一单成稿 job(不限状态):/design 轮询用它区分「在跑/写完/失败」。
  findLatestComposeByAlbum: async (albumId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.albumId, albumId), eq(agentJobs.kind, 'compose')))
      .orderBy(desc(agentJobs.createdAt), desc(agentJobs.id))
      .limit(1);
    return rows[0];
  },
```

`listCoverSets` 尾部改为一次查询同时给两个字段(`findActiveComposeByAlbum` 若 grep 确认无其它调用点则一并删除):

```ts
    const latestCompose = await agentJobRepo.findLatestComposeByAlbum(albumId);
    return {
      sets: buildCoverSets(albumId, chapters.map((c) => ({ photos: c.photos ?? [] }))),
      designed,
      hasPages: rawPages.length > 0,
      // 成稿在跑(异步 compose job 未回调):前端别再弹选择卡,直接进轮询等这一单。
      composing: latestCompose?.status === 'QUEUED' || latestCompose?.status === 'RUNNING',
      // 追加范围成稿的完成信号:前端轮询它从 RUNNING 走到 COMPLETED/FAILED。
      lastComposeStatus: latestCompose?.status ?? null,
    };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test -- src/services/album/compose-append-flow.test.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/db/repos/agent-job-repo.ts apps/web/src/services/album/album-service.ts apps/web/src/services/album/compose-append-flow.test.ts
git commit -m "feat(web): /design 透出 lastComposeStatus —— 追加成稿的前端完成信号"
```

---

### Task 6: 前端接线 —— 追加排版收尾派发成稿 + 轮询

**Files:**
- Modify: `apps/web/src/lib/generation/client.ts`(`submitAddPhotosV3` 附近)
- Modify: `apps/web/src/components/album/editor-v2/ChatPanel.tsx`(appendScope 类型、`triggerAppendSelectLayout`、`waitForLayoutThenRefresh` append 分支;新增 `triggerAppendCompose` / `waitForAppendComposeThenRefresh`)
- Test: Create `apps/web/src/components/album/editor-v2/append-compose-wiring.test.ts`(源码断言防退化,`page-reorder-wiring.test.ts` 同款)

**Interfaces:**
- Consumes: Task 3 的 POST `/compose-append`、Task 5 的 `lastComposeStatus`;既有 `selectLayoutRefsFromStore` / `appendThinkingShell` / `settleThinking` / `withWorkflowBusy` / `maybeAppendExportReadyCard` / `loadStoryGate`。
- Produces: client 层 `composeAppendV3(albumId, input)` 与 `fetchDesignState(albumId)`。

- [ ] **Step 1: 写防退化测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 防退化:#305 后加图路径丢过一次写文案(judge 时代的 write_copy 没接回来)。
// 锁死接线:追加排版收尾必须派发追加范围成稿并轮询其完成。
test('append 收尾接了追加范围成稿', () => {
  const src = readFileSync(join(__dirname, 'ChatPanel.tsx'), 'utf8');
  assert.ok(src.includes('triggerAppendCompose('), 'append 收尾要调 triggerAppendCompose');
  assert.ok(src.includes('composeAppendV3('), 'triggerAppendCompose 要 POST compose-append');
  assert.ok(src.includes('waitForAppendComposeThenRefresh('), '派发后要轮询成稿完成');
});
```

Run: `cd apps/web && pnpm test -- src/components/album/editor-v2/append-compose-wiring.test.ts` → FAIL

- [ ] **Step 2: client 层两个函数**(client.ts,401 → `UnauthorizedError` 口径对齐本文件既有 `fetchDraftSkeleton`)

```ts
// 追加范围成稿:加图增量排版落地后,只为新章内页写文案。composed:false = 书未设计,
// 新页文案等选封面时随全书成稿一起写。
export async function composeAppendV3(
  albumId: string,
  input: { language: 'zh' | 'en'; chapterIds: string[]; refs: Record<string, string> },
): Promise<{ accepted: true; composed: boolean; requestId?: string }> {
  const res = await fetch(`/api/v3/albums/${albumId}/compose-append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new UnauthorizedError();
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? 'append compose failed');
  return json.data;
}

// /design 轻量状态(追加成稿轮询用):composing + 最近一单 compose 的最终状态。
export async function fetchDesignState(
  albumId: string,
): Promise<{ composing: boolean; lastComposeStatus: string | null }> {
  const res = await fetch(`/api/v3/albums/${albumId}/design`);
  if (res.status === 401) throw new UnauthorizedError();
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? 'design state failed');
  return { composing: !!json.data.composing, lastComposeStatus: json.data.lastComposeStatus ?? null };
}
```

- [ ] **Step 3: ChatPanel 改造**

3a. appendScope 类型加两个可选字段(声明处):

```ts
    let appendScope: {
      chapterIds: string[];
      photoIds: string[];
      prevPageCount: number;
      // 增量排版实际范围(fresh ∪ 滞留章)与其照片:triggerAppendSelectLayout 填,
      // 追加成稿(triggerAppendCompose)按同一范围写文案 —— 两者必须同源。
      layoutChapterIds?: string[];
      refsPhotoIds?: string[];
    } | null = null;
```

3b. `triggerAppendSelectLayout` 里 `submitSelectLayoutV3` 之前,把已算好的范围存回 scope:

```ts
        appendScope = { ...scope, layoutChapterIds, refsPhotoIds };
```

3c. `waitForLayoutThenRefresh` 的 append 分支改为(替换原「新照片排进书里了…」+ 收尾三行):

```ts
            if (opts?.append) {
              // 追加完成:新章已被服务端记 done,闸门随 allDone 恢复;设计过的书样式已继承。
              const scope = appendScope;
              appendScope = null;
              appendInFlight = false;
              await loadStoryGate();
              const designed = draft.pages.some((p) => p.kind === 'cover');
              if (!designed || !scope?.layoutChapterIds?.length) {
                // 书还没设计:新页文案等选封面时随全书成稿一起写,保持既有收尾。
                appendReplyBody(
                  host,
                  aT('新照片排进书里了,样式跟全书保持一致。想调整就在对话里告诉我。',
                     'The new photos are in — styled to match the rest of the book. Ask me here to tweak anything.'),
                );
                maybeAppendExportReadyCard();
              } else {
                appendReplyBody(
                  host,
                  aT('新照片排进书里了。我再给新页面写上文案,稍等片刻。',
                     'The new photos are in — now writing their copy, one moment.'),
                );
                await triggerAppendCompose({
                  chapterIds: scope.layoutChapterIds,
                  photoIds: scope.refsPhotoIds ?? scope.photoIds,
                });
              }
            } else {
```

3d. 新增两个函数(放在 `waitForComposeThenRefresh` 之后,复用其口径):

```ts
    // 追加范围成稿:排版落地后只为新章写文案(服务端派发 engine /v3/compose 空槽单)。
    async function triggerAppendCompose(scope: { chapterIds: string[]; photoIds: string[] }) {
      if (disposed) return;
      const host = appendThinkingShell();
      setThinkingLabel(host, 'Writing copy for the new pages…');
      setSending(true);
      try {
        let refs: Record<string, string> = {};
        try {
          refs = await selectLayoutRefsFromStore(scope.photoIds);
        } catch {
          // 原图不在本设备也照写:模型少看图,文案仍从章节上下文出。
        }
        if (disposed) return;
        const res = await composeAppendV3(albumId, {
          language: currentLang === 'zh' ? 'zh' : 'en',
          chapterIds: scope.chapterIds,
          refs,
        });
        if (disposed) return;
        if (!res.composed) {
          settleThinking(host, 'analyzedFeedback');
          maybeAppendExportReadyCard();
          return;
        }
        void withWorkflowBusy(() => waitForAppendComposeThenRefresh(host));
      } catch (e) {
        settleThinking(host, 'analyzedFeedback');
        if (!authErr(host, e)) {
          appendReplyBody(host, aT(
            '新照片排进去了,但文案没能开始写。在对话里跟我说「给新页写文案」,我来补。',
            "The new photos are in, but I couldn't start writing their copy. Tell me here to write it and I'll fill them in.",
          ));
          maybeAppendExportReadyCard();
        }
      } finally {
        setSending(false);
        if (!disposed) { restAwait(); scrollChat(); }
      }
    }

    // 轮询 /design 等追加成稿收尾:RUNNING → COMPLETED/FAILED。封顶与全书成稿同档 12 分钟。
    async function waitForAppendComposeThenRefresh(host: HTMLElement) {
      const deadline = Date.now() + 12 * 60 * 1000;
      while (!disposed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        if (disposed) return;
        try {
          const state = await fetchDesignState(albumId);
          if (state.composing) continue;
          settleThinking(host, 'analyzedFeedback');
          window.dispatchEvent(new CustomEvent('yujee:authoring-pages-ready'));
          appendReplyBody(host, state.lastComposeStatus === 'COMPLETED'
            ? aT('新页面的文案写好了,和全书一个声音。不合口味随时在对话里改。',
                 'The new pages now have their copy, in the same voice as the rest of the book. Ask me here to tweak anything.')
            : aT('新照片排进去了,但文案没写上。在对话里跟我说「给新页写文案」,我来补。',
                 "The new photos are in, but their copy didn't come through. Tell me here to write it and I'll fill them in."));
          await loadStoryGate();
          maybeAppendExportReadyCard();
          return;
        } catch (e) {
          if (e instanceof UnauthorizedError) return;
          // 其它瞬时错误:继续轮询到封顶,不把错误灌进对话
        }
      }
      if (!disposed) {
        settleThinking(host, 'analyzedFeedback');
        appendReplyBody(host, aT('还在写新页面的文案,稍后回来看看,写好会直接出现在画板上。',
          'Still writing the new pages — come back in a bit and the copy will show up on the canvas.'));
      }
    }
```

imports 补 `composeAppendV3, fetchDesignState`(来自 `@/lib/generation/client` 既有 import 行)。

注意:回调侧(Task 4)已落了一条 assistant 回执进会话历史,前端这条 `appendReplyBody` 是当场即时回执 —— 刷新后历史回放只会看到回调那条,不重复;与全书成稿「回调补 assistant 回执」同口径。

- [ ] **Step 4: 跑防退化测试 + 该目录既有测试**

Run: `cd apps/web && pnpm test -- src/components/album/editor-v2/`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/generation/client.ts apps/web/src/components/album/editor-v2/ChatPanel.tsx apps/web/src/components/album/editor-v2/append-compose-wiring.test.ts
git commit -m "feat(editor): 加图收尾接追加范围成稿 —— 排版落地即写新页文案并轮询回执"
```

---

### Task 7: 文档 + checked-at + 全量验证

**Files:**
- Modify: `engine/README.md`(compose 节补一行:「coverSlots/endingSlots 全空 = 追加范围成稿,跳过全局批次」)
- Modify: 仓根 `README.md` 与 `apps/web/README.md` 中涉及「加照片增量重跑」工作流的段落(若有),补「排版落地后自动追加成稿」一句
- 各文档 doc-scope 的 `checked-at` 推进到本批提交

- [ ] **Step 1: 按 doc-scope 规则核对/更新三份 README,推进 checked-at**
- [ ] **Step 2: 全量验证(仓根)**

```bash
pnpm typecheck                                                   # 含 docs:check
cd apps/web && pnpm test                                         # web 全量
cd .. && PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests   # engine 全量
```

Expected: 三项全绿;`pnpm test`(仓根)如跑,注意它撞第一个失败的包就中断的陷阱。

- [ ] **Step 3: Commit + push main**

```bash
git add -A && git commit -m "docs: 追加范围成稿落地,相关 README checked-at 推进"
git push origin main   # CI 自动部署 web + engine
```

- [ ] **Step 4: 线上验证**(部署完成后)
  - 找一本已设计的书 → 对话里加 2-3 张照片 → 走完采访;
  - 观察 engine 日志:`v3_compose.accepted` 且 trace `chapterCount` = 新章数、`hasUserFontChoice=false`、无 cover 槽;
  - 新页文案应为 Gemini 手笔(非模板 sample),老页与手改文案不动;对话里出现「新页面的文案写好了」回执。

---

## Self-Review 结论

- 覆盖检查:根因(无派发)→ Task 3/6 补派发与触发;范围写文案 → Task 1(engine 跳全局)+ Task 3(空槽请求);老页不动 → Task 2/4(只合并 pagesTexts 目标页);完成信号 → Task 5;防退化 → Task 6 源码断言。未设计的书维持现状(Task 3 composed:false + Task 6 分支)。
- 类型一致:`ComposeAppendJobMeta`、`composeAppendV3` 返回形状、`lastComposeStatus` 取值在 Task 2/3/5/6 间一致。
- 已知取舍:① compose 在跑时手改新页文案会被回调覆盖(全书成稿同款竞态,不加锁);② 追加成稿期间导出闸门已开(allDone 在排版落地即恢复),用户抢先导出会拿到 sample 文案 —— 概率低,先不动导出闸门,线上观察。
