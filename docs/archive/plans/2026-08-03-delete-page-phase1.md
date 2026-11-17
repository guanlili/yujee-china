# 删除书页 Phase 1(手动删除)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在编辑器里手动删除一张内页(连图带文),移动端接通已有按钮,桌面端新增选中页入口。

**Architecture:** 规格 `docs/specs/2026-08-03-delete-page-design.md`。服务层 `deletePage` 照抄 `reorderPages` 事务骨架(行锁 → 懒播种 → loadStoryDraft 路由判定 → 过滤+重排 → replaceAll → pageCount 收口);API 是 `pages/[idx]` 路由的新 `DELETE` 导出;两端 UI 均为乐观更新 + 失败回滚。Phase 2(design-agent `delete_page` 工具)**不在本计划**,等拆表计划 Task 6。

**Tech Stack:** Drizzle + Postgres · node:test + tsx · Next.js App Router · 命令式 DOM(EditorPort)/ React(mobile)

## Global Constraints

- 分支 `feat/collab-editing`;`git add` 只加本任务文件(在途并行工作的脏文件一律不碰)。
- 测试:单文件 `pnpm --filter @yujee/web exec tsx --test <file>`;全包 `cd apps/web && pnpm test`。DB 集成测试用 `isDbReachable()` skip 惯例。仓根 `pnpm test` 撞第一个失败包就中断,不要只看它。
- 本地不要跑 `db:migrate`(dev 库 drizzle 账本漂移)。本计划无 schema 变更,不涉迁移。
- 语义契约(规格已定):只删内页(含双宽);图片随页移除不回流;拒绝删到内页数为 0;web 侧余页 `pageIndex` 重排 0..n-1;`pageCount` 收口;`COMPLETED → EDITING`。
- 翻面提示:删普通内页确认时提示「后续页面左右位置将互换」;删双宽页(`spread: true`,净减 2 个页位)不提示。
- commit 尾注:`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 服务层 `deletePage` + `DELETE` 路由

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts`(插在 `reorderPages` 之后,≈:1523)
- Modify: `apps/web/src/app/api/v1/albums/[uuid]/pages/[idx]/route.ts`
- Test: `apps/web/src/services/album/album-service.test.ts`(追加在 reorderPages 用例组后)

**Interfaces:**
- Consumes: `albumRepo.findByIdForUpdate` / `ensureDraftPagesSeeded` / `loadStoryDraft` / `bumpDraftRevision` / `draftPageRepo.replaceAll` / `albumPageRepo.{findByAlbum,deleteByAlbum,bulkInsert}` / `getTemplate`(全部已在 album-service.ts 引入)
- Produces: `albumService.deletePage(userId: string, albumId: string, pageIndex: number): Promise<{ updated: true }>`;HTTP `DELETE /api/v1/albums/[uuid]/pages/[idx]` → `{ok:true,data:{updated:true}}`(Task 3/4 的前端调它)

- [ ] **Step 1: 写失败测试** — 在 `album-service.test.ts` 的 reorderPages 用例组之后追加(fixture 复用同文件已有的 `reorderFixturePage` / `makeUser` / `makeAlbum` / `makeStoryTree` / `cleanupUser` / `isDbReachable`):

```ts
// ── deletePage:删除书页(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md)──
// 只删内页,图片随页移除不回流;余页 pageIndex 重排 0..n-1;pageCount 收口;
// COMPLETED → EDITING。校验失败一律 VALIDATION_FAILED 且不落库。

test('deletePage(draft 相册):删内页后行数-1,pageIndex 连续,整条记录跟着走;version 推进;pageCount 收口;COMPLETED 退回 EDITING', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-draft');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'COMPLETED', stage: 'story', draftJson: wrapped });

    await albumService.deletePage(user.id, album.id, 1);

    const after = await albumRepo.findById(album.id);
    const rows = await draftPageRepo.findByAlbum(album.id);
    const pages = rows.map((r) => r.page as Page & { html?: string; texts: Record<string, string> });
    assert.deepEqual(
      pages.map((p) => [p.pageIndex, p.texts.title]),
      [
        [0, 'COVER'],
        [1, 'B'],
      ],
      '被删页消失,余页 pageIndex 重排连续',
    );
    assert.match(pages[1]!.html!, />B</, '余页整条记录原样跟着走,html 不重烘');
    assert.equal(after?.status, 'EDITING', '删页是一次编辑,COMPLETED 须退回 EDITING');
    assert.equal(after?.pageCount, 2, 'pageCount 收口:删后与行数一致');
    for (const row of rows) {
      assert.equal(row.version, after!.draftRevision, `第 ${row.pageIndex} 行 version 必须等于新 draftRevision`);
    }
  } finally {
    await cleanupUser(user.id);
  }
});

test('deletePage(draft 相册):双宽内页(spread 模板)同样可删', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-spread');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'A'),
        reorderFixturePage(2, 'mag-54', 'S'), // mag-54: interior + spread:true
        reorderFixturePage(3, 'mag-05', 'B'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    await albumService.deletePage(user.id, album.id, 2);

    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.deepEqual(
      rows.map((r) => [(r.page as Page).pageIndex, ((r.page as Page).texts as Record<string, string>).title]),
      [
        [0, 'COVER'],
        [1, 'A'],
        [2, 'B'],
      ],
    );
  } finally {
    await cleanupUser(user.id);
  }
});

test('deletePage:拒绝 —— 删 cover 类目页/删最后一张内页/越界,一律 VALIDATION_FAILED 且不落库', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-invalid');
  try {
    const album = await makeAlbum(user.id);
    const wrapped: V3StoryDraft = {
      version: 'v3-story',
      tree: makeStoryTree(1),
      pages: [
        reorderFixturePage(0, 'mag-01', 'COVER'),
        reorderFixturePage(1, 'mag-03', 'ONLY'),
      ],
      progress: { currentChapterId: null, doneChapterIds: ['c1'] },
    };
    await albumRepo.update(db, album.id, { status: 'EDITING', stage: 'story', draftJson: wrapped });

    const rejects = (idx: number) =>
      assert.rejects(
        albumService.deletePage(user.id, album.id, idx),
        (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
      );
    await rejects(0); // cover 类目:锚定页不许删(服务端二次把关,不只靠前端置灰)
    await rejects(1); // 最后一张内页:拒绝删到内页数为 0
    await rejects(9); // 越界
    const rows = await draftPageRepo.findByAlbum(album.id);
    assert.equal(rows.length === 0 || rows.length === 2, true, '拒绝路径不落库(懒播种前 0 行,播种后 2 行,但绝不会是 1 行)');
  } finally {
    await cleanupUser(user.id);
  }
});

test('deletePage(无 draft 存量相册):album_pages 行过滤后 pageIndex 重写,整行内容原样', async (t) => {
  if (!(await isDbReachable())) return t.skip('db not reachable');
  const user = await makeUser('wp-delete-legacy');
  try {
    const album = await makeAlbum(user.id);
    await albumPageRepo.bulkInsert(db, [
      { albumId: album.id, pageIndex: 0, templateId: 'mag-01', imagesJson: {}, textsJson: { title: 'COVER' } },
      { albumId: album.id, pageIndex: 1, templateId: 'mag-03', imagesJson: { a: 'p1' }, textsJson: { title: 'A' } },
      { albumId: album.id, pageIndex: 2, templateId: 'mag-05', imagesJson: { b: 'p2' }, textsJson: { title: 'B' } },
    ]);

    await albumService.deletePage(user.id, album.id, 1);

    const rows = await albumPageRepo.findByAlbum(db, album.id);
    assert.deepEqual(
      rows.map((r) => [r.pageIndex, (r.textsJson as Record<string, string>).title]),
      [
        [0, 'COVER'],
        [1, 'B'],
      ],
    );
    assert.deepEqual(rows[1]!.imagesJson, { b: 'p2' }, '整行内容原样跟着走');
  } finally {
    await cleanupUser(user.id);
  }
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/album-service.test.ts`;Expected: FAIL(`albumService.deletePage is not a function`)。DB 不可达则 skip —— 需先起本地 db(沿用既有集成测试环境)。

- [ ] **Step 3: 实现 service** — 在 `album-service.ts` 的 `reorderPages` 方法后(:1523 的 `},` 之后)插入:

```ts
  // ── 删除书页(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md)。
  // 只删内页(cover/toc/ending 拒绝 —— 服务端二次把关,不只靠前端置灰);图片随页
  // 移除不回流;拒绝删到内页数为 0。余页 pageIndex 重排 0..n-1(PK (albumId,
  // pageIndex) 要求连续无洞),pageCount 收口,COMPLETED → EDITING。
  // 事务骨架与路由判定照抄 reorderPages(理由见其抬头):行锁 → 懒播种 →
  // loadStoryDraft 判定行/存量路径。bake:false —— 删页不碰余页 html 一个字节。
  async deletePage(
    userId: string,
    albumId: string,
    pageIndex: number,
  ): Promise<{ updated: true }> {
    await db.transaction(async (tx) => {
      const latest = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
      if (latest.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      const seededRevision = await ensureDraftPagesSeeded(tx, latest);
      const draft = await loadStoryDraft(latest, { tx, bake: false });
      const hasDraft = !!draft && draft.pages.length > 0;
      const legacyRows = hasDraft ? null : await albumPageRepo.findByAlbum(tx, albumId);
      const n = hasDraft ? draft!.pages.length : legacyRows!.length;

      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= n) {
        throw ERRORS.VALIDATION_FAILED(`page ${pageIndex} out of range 0..${n - 1}`);
      }
      const templateIdAt = (i: number): string =>
        hasDraft ? draft!.pages[i]!.templateId : legacyRows![i]!.templateId;
      const category = getTemplate(templateIdAt(pageIndex))?.category;
      if (category !== 'interior') {
        throw ERRORS.VALIDATION_FAILED(
          `page ${pageIndex} (${category ?? 'unknown'}) is anchored and cannot be deleted`,
        );
      }
      // 下限保护:删后至少留一张内页(规格:拒绝删到内页数为 0)。
      let interiorCount = 0;
      for (let i = 0; i < n; i++) {
        if (getTemplate(templateIdAt(i))?.category === 'interior') interiorCount += 1;
      }
      if (interiorCount <= 1) {
        throw ERRORS.VALIDATION_FAILED('cannot delete the last interior page');
      }

      if (hasDraft) {
        const remaining = draft!.pages
          .filter((_, i) => i !== pageIndex)
          .map((page, newIdx) => ({ ...page, pageIndex: newIdx }));
        const rev = await bumpDraftRevision(tx, albumId, seededRevision);
        await draftPageRepo.replaceAll(tx, albumId, remaining, rev, userId);
        // envelope(tree/progress/design)不重写:删页没有动 tree/progress。
        // pageCount 收口:页数变化写点必须显式跟上(同 reorderPages 收口点一)。
        await albumRepo.update(tx, albumId, {
          pageCount: remaining.length,
          ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
        });
        return;
      }

      // 存量路径(album_pages 行):unique(albumId,pageIndex) 原地平移会撞索引,
      // 与 reorderPages 同法 delete-then-bulkInsert。
      await albumPageRepo.deleteByAlbum(tx, albumId);
      await albumPageRepo.bulkInsert(
        tx,
        legacyRows!
          .filter((_, i) => i !== pageIndex)
          .map((row, newIdx) => {
            const { id: _id, updatedAt: _u, ...rest } = row;
            return { ...rest, pageIndex: newIdx };
          }),
      );
      await albumRepo.update(tx, albumId, {
        pageCount: legacyRows!.length - 1,
        ...(latest.status === 'COMPLETED' ? { status: 'EDITING' as const } : {}),
      });
    });
    return { updated: true };
  },
```

- [ ] **Step 4: 实现路由** — 在 `pages/[idx]/route.ts` 文件末尾追加(镜像同文件 `PATCH` 的骨架,无 body):

```ts
// 删除书页(2026-08-03 设计):只删内页,图片随页移除;校验与语义都在 service 层。
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ uuid: string; idx: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { uuid, idx } = await ctx.params;
    const data = await albumService.deletePage(user.id, uuid, Number(idx));
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
```

- [ ] **Step 5: 跑测试确认通过** — Run: `pnpm --filter @yujee/web exec tsx --test src/services/album/album-service.test.ts` + `pnpm --filter @yujee/web typecheck`;Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/album/album-service.ts apps/web/src/services/album/album-service.test.ts "apps/web/src/app/api/v1/albums/[uuid]/pages/[idx]/route.ts"
git commit -m "feat(web): deletePage 服务与 DELETE 路由(删除书页 Phase 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: buildSpreads 删页安全回归守卫

**Files:**
- Test: `apps/web/src/components/album/spreads.test.ts`(追加用例)

**Interfaces:**
- Consumes: `buildSpreads` / `spreadPageIndices`(`spreads.ts`,已导出);`EditorPage`(`../types`)
- Produces: 无新代码 —— 纯回归守卫。`buildSpreads` 在 placePages 不变式被打破时会 throw(`spreads.ts:63`,宁炸不丢页),此守卫钉住「删除任意一张内页/双宽页后重建 spreads 不炸、页数守恒」。

- [ ] **Step 1: 追加守卫用例**(沿用该文件既有的 EditorPage fixture 写法;若已有构造 helper 直接复用,没有就地写最小对象):

```ts
// ── 删页安全(2026-08-03 删除书页设计):删除任意一张内页后 buildSpreads 必须
// 不炸且页数守恒(奇偶位、双宽页都覆盖)。buildSpreads 对不变式破坏是 throw
// (宁炸不丢页),所以「不炸 + 面数守恒」= 删页后全书仍可渲染。──────────────
test('删除任意一张内页后 buildSpreads 不炸,占用面数 == 余页数(含双宽/奇偶位)', () => {
  const page = (templateId: string): EditorPage => ({
    pageIndex: 0,
    templateId,
    imagesJson: {},
    textsJson: {},
  });
  // 结构:封面 + 4 张普通内页夹 1 张双宽 + 封尾 —— 奇偶位内页、双宽页都在场。
  const book = [
    page('mag-01'), // cover
    page('mag-03'),
    page('mag-05'),
    page('mag-54'), // interior + spread:true(双宽)
    page('mag-03'),
    page('mag-05'),
    page('mag-20'), // ending
  ];
  for (let removed = 1; removed <= 5; removed++) {
    const remaining = book.filter((_, i) => i !== removed).map((p, i) => ({ ...p, pageIndex: i }));
    const spreads = buildSpreads(remaining); // 不 throw 即通过一半
    const occupied = spreads.flatMap((s) => spreadPageIndices(s));
    assert.equal(occupied.length, remaining.length, `删第 ${removed} 页后页数必须守恒(不丢页)`);
    assert.deepEqual([...occupied].sort((a, b) => a - b), remaining.map((_, i) => i), '每一页都被恰好一个跨页持有');
  }
});
```

(模板类目已核实:mag-01 cover、mag-03/mag-05 interior、mag-54 interior+spread、mag-20 ending。)

- [ ] **Step 2: 跑测试** — Run: `pnpm --filter @yujee/web exec tsx --test src/components/album/spreads.test.ts`;Expected: PASS(这是回归守卫,现状就该绿;若红,说明删页形状真的会炸渲染,升级为 bug 处理,不许删测试)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/album/spreads.test.ts
git commit -m "test(web): buildSpreads 删页安全回归守卫

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 移动端接通删除按钮

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx`(:784 的 `onDeletePage`、`commitReorder` 附近加 `commitDeletePage`、`<ReorderSheet>` 附近挂确认弹窗)
- Modify: `apps/web/src/components/album/editor-v2/mobile/EditView.tsx`(:778 删除格置灰)
- Modify: `apps/web/src/components/album/editor-v2/mobile/mobile-editor.css`(确认弹窗 + 置灰样式)

**Interfaces:**
- Consumes: `albumService.deletePage` 经 `DELETE /api/v1/albums/${detail.album.id}/pages/${pageIndex}`(Task 1);`ModalHost`(`./modals/ModalHost`,已存在);`getTemplate`(MobileEditorRoot :19 已引入);`soon`/`say`/`setPages`/`setEditPage`/`setSelection`/`closeSheet`(MobileEditorRoot 已有)
- Produces: 移动端删除交互闭环。`data-testid="delete-page-confirm"`(弹窗)与 `data-testid="delete-page-confirm-btn"`(确认钮)供 Task 4 接线守卫断言。

- [ ] **Step 1: MobileEditorRoot 加状态与提交函数** — 在 `commitReorder`(:466-481)之后插入:

```ts
  // ── 删除书页(2026-08-03 设计):确认弹窗 → 乐观删除 + DELETE,失败回滚 + toast,
  // 与 commitReorder 同口径。spread 记录当前页是否双宽 —— 双宽净减 2 个页位后续
  // 不移位,不用提示翻面;普通内页净减 1,后续页左右互换,确认弹窗里明说。
  const [deleteConfirm, setDeleteConfirm] = useState<{ pageIndex: number; spread: boolean } | null>(
    null,
  );
  const requestDeletePage = () => {
    if (editPage == null || !pages[editPage]) return;
    const tpl = getTemplate(pages[editPage]!.templateId);
    if (tpl?.category !== 'interior') {
      say(zh ? '封面、目录和封底不能删除' : 'Cover, contents and ending pages cannot be deleted');
      return;
    }
    const interiorCount = pages.filter(
      (p) => getTemplate(p.templateId)?.category === 'interior',
    ).length;
    if (interiorCount <= 1) {
      say(zh ? '这是最后一张内页，不能删除' : 'The last interior page cannot be deleted');
      return;
    }
    setDeleteConfirm({ pageIndex: editPage, spread: tpl.spread === true });
  };
  const commitDeletePage = (pageIndex: number) => {
    const prev = pages;
    setPages(prev.filter((_, i) => i !== pageIndex).map((p, newIdx) => ({ ...p, pageIndex: newIdx })));
    // 被删的页正处于编辑焦点,必须退出编辑态(留着会指到错位的页)。
    setEditPage(null);
    setSelection(null);
    closeSheet();
    void fetch(`/api/v1/albums/${detail.album.id}/pages/${pageIndex}`, { method: 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error(`delete ${res.status}`);
      })
      .catch(() => {
        setPages(prev);
        say(zh ? '页面没有删掉，已恢复，请重试' : 'Page not deleted; restored — please retry');
      });
  };
```

(若 `closeSheet` 在此作用域名字不同,以 `onExitEdit`(:726-730)里退出编辑焦点的三连调用为准照抄。)

- [ ] **Step 2: 接上按钮与弹窗** — `:784` 一行换成 `onDeletePage={requestDeletePage}`;在 `<ReorderSheet ... />`(:917 附近)同层加:

```tsx
    <ModalHost
      open={deleteConfirm != null}
      onClose={() => setDeleteConfirm(null)}
      ariaLabel={zh ? '删除页面' : 'Delete page'}
      testId="delete-page-confirm"
    >
      <div className="mdel-body">
        <p className="mdel-title">{zh ? '删除这一页？' : 'Delete this page?'}</p>
        <p className="mdel-text">
          {zh ? '页面上的照片和文字会一起移除。' : 'Its photos and text will be removed together.'}
        </p>
        {deleteConfirm != null && !deleteConfirm.spread && (
          <p className="mdel-text mdel-warn">
            {zh
              ? '删除后，这一页之后的页面左右位置会互换。'
              : 'After deleting, pages after this one will swap left/right sides.'}
          </p>
        )}
      </div>
      <div className="mdel-actions">
        <button type="button" className="mdel-btn" onClick={() => setDeleteConfirm(null)}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button
          type="button"
          className="mdel-btn mdel-danger"
          data-testid="delete-page-confirm-btn"
          onClick={() => {
            const target = deleteConfirm;
            setDeleteConfirm(null);
            if (target) commitDeletePage(target.pageIndex);
          }}
        >
          {zh ? '删除' : 'Delete'}
        </button>
      </div>
    </ModalHost>
```

`ModalHost` 若尚未 import:`import { ModalHost } from './modals/ModalHost';`(与 ReorderSheet 等同目录引入方式对齐)。

- [ ] **Step 3: EditView 删除格置灰** — `EditView.tsx` 顶部加 `import { getTemplate } from '@yujee/contracts/templates';`;`:778` 的删除按钮换成(EditView 已有 `pages` 与 `editPage` props):

```tsx
        {(() => {
          const current = editPage != null ? pages[editPage] : undefined;
          const deletable = current ? getTemplate(current.templateId)?.category === 'interior' : false;
          return (
            <button
              type="button"
              className="ml1-cell"
              data-danger="1"
              aria-disabled={deletable ? undefined : true}
              onClick={onDeletePage}
            >
              <IconTrash className="ml1-ic" />
              <span>{zh ? '删除' : 'Delete'}</span>
            </button>
          );
        })()}
```

置灰仍可点(点了由 root 的 `requestDeletePage` toast 说明原因)—— 沿用「不做死按钮」的既有口径,置灰只是视觉预告。

- [ ] **Step 4: mobile-editor.css 加样式** — 在文件末尾追加:

```css
/* ── 删除书页确认弹窗(2026-08-03):挂在 ModalHost(.modal-card)里。── */
.mobile-modal-host .mdel-body { padding: 20px 20px 4px; display: grid; gap: 8px; }
.mobile-modal-host .mdel-title { font-size: 17px; font-weight: 600; }
.mobile-modal-host .mdel-text { font-size: 14px; opacity: 0.75; line-height: 1.5; }
.mobile-modal-host .mdel-warn { opacity: 1; color: #b45309; }
.mobile-modal-host .mdel-actions { display: flex; gap: 10px; padding: 16px 20px 20px; }
.mobile-modal-host .mdel-btn {
  flex: 1; padding: 11px 0; border-radius: 10px; font-size: 15px;
  border: 1px solid rgba(0, 0, 0, 0.12); background: transparent;
}
.mobile-modal-host .mdel-danger { background: #dc2626; border-color: #dc2626; color: #fff; }
/* 一级栏删除格:非内页时置灰(仍可点,点了 toast 说明原因)。 */
.ml1-cell[aria-disabled='true'] { opacity: 0.35; }
```

(颜色若与项目色板变量冲突,以 mobile-editor.css 里既有 danger 色为准替换。)

- [ ] **Step 5: 验证** — Run: `pnpm --filter @yujee/web typecheck` + `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/mobile/modals/modals.test.ts`;Expected: PASS。再 `pnpm design:album` 之外的移动端人工核对不在本任务(无 e2e 基建),靠 Task 4 的接线守卫钉源码。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/album/editor-v2/mobile/MobileEditorRoot.tsx apps/web/src/components/album/editor-v2/mobile/EditView.tsx apps/web/src/components/album/editor-v2/mobile/mobile-editor.css
git commit -m "feat(web): 移动端删除书页接通(确认弹窗+乐观回滚)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 桌面端删除入口 + 双端接线守卫

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`(page 组加钮 :6127 后、dispatch :4616 后、`confirmPageReorder` 后加函数、`showElementToolbar` page 分支 :3765 附近)
- Modify: `apps/web/src/components/album/editor-v2/editor-coordinator.ts`(zh :104 / en :263 两张表加文案)
- Test: `apps/web/src/components/album/editor-v2/delete-page-wiring.test.ts`(新建,镜像 `page-reorder-wiring.test.ts` 的源码 pin 写法)

**Interfaces:**
- Consumes: `DELETE /api/v1/albums/${albumId}/pages/${idx}`(Task 1);`pagesState`/`selectedPageIndex`/`rebuildSpreads`/`repaintBook`/`hideElementToolbar`/`updateSelectionHighlight`/`getTemplate`/`t`(EditorPort 已有;`rebuildSpreads` 自带 `currentCh` 钳位 :1530)
- Produces: `data-edit-action="delete-page"` 按钮 + `deleteSelectedPage()`;editor-coordinator 新 i18n 键 `deletePageConfirm/deletePageFlipNote/deletePageFailed/deletePageLast/deletePageAnchored`

- [ ] **Step 1: i18n 文案** — `editor-coordinator.ts` zh 表(:104 附近,与 `pageReorderFailed` 并排)加:

```ts
    deletePageConfirm: '删除这一页？页面上的照片和文字会一起移除。',
    deletePageFlipNote: '删除后，这一页之后的页面左右位置会互换。',
    deletePageFailed: '页面没有删掉，已恢复，请重试',
    deletePageLast: '这是最后一张内页，不能删除',
    deletePageAnchored: '封面、目录和封底不能删除',
```

en 表(:263 附近)加:

```ts
    deletePageConfirm: 'Delete this page? Its photos and text will be removed together.',
    deletePageFlipNote: 'After deleting, pages after this one will swap left/right sides.',
    deletePageFailed: 'The page was not deleted; restored — please retry',
    deletePageLast: 'The last interior page cannot be deleted',
    deletePageAnchored: 'Cover, contents and ending pages cannot be deleted',
```

- [ ] **Step 2: page 组加删除钮** — `EditorPort.tsx` :6127 的 reorder pill 之后(同一 `data-group="page"` div 内)加:

```tsx
            <button type="button" className="eb-pill" data-edit-action="delete-page" data-testid="eb-page-delete">
              {locale === 'zh' ? '删除此页' : 'Delete page'}
            </button>
```

- [ ] **Step 3: 非内页隐藏删除钮** — `showElementToolbar` 的 `group === 'page'` 分支(:3765 附近)里加(锚点:该分支现有对 page 组的初始化逻辑末尾):

```ts
      // 删除钮只对内页出现:封面/目录/封尾根本不给入口(服务端仍二次把关)。
      const delBtn = editBar?.querySelector<HTMLElement>('[data-edit-action="delete-page"]');
      if (delBtn) {
        const pg = selectedPageIndex != null ? pagesState[selectedPageIndex] : undefined;
        delBtn.style.display =
          pg && getTemplate(pg.templateId)?.category === 'interior' ? '' : 'none';
      }
```

- [ ] **Step 4: dispatch + 删除函数** — dispatch(:4616)加一行:

```ts
      if (action === 'delete-page') { closeEbPanels(); void deleteSelectedPage(); return; }
```

`confirmPageReorder`(:2889)之后加:

```ts
    // ── 删除书页(2026-08-03 设计):window.confirm 知情确认(普通内页附翻面提示,
    // 双宽页净减 2 个页位不提示)→ 乐观删除 + DELETE,失败回滚,与 confirmPageReorder
    // 同口径。rebuildSpreads 自带 currentCh 钳位,删掉最后一个跨页也不会画越界。
    async function deleteSelectedPage() {
      if (selectedPageIndex == null) return;
      const idx = selectedPageIndex;
      const page = pagesState[idx];
      if (!page) return;
      const tpl = getTemplate(page.templateId);
      if (tpl?.category !== 'interior') { alert(t('deletePageAnchored')); return; }
      const interiorCount = pagesState.filter(
        (p) => getTemplate(p.templateId)?.category === 'interior',
      ).length;
      if (interiorCount <= 1) { alert(t('deletePageLast')); return; }
      const msg = tpl.spread === true
        ? t('deletePageConfirm')
        : `${t('deletePageConfirm')}\n${t('deletePageFlipNote')}`;
      if (!window.confirm(msg)) return;
      const prev = pagesState;
      selectedPageIndex = null;
      hideElementToolbar();
      pagesState = prev.filter((_, i) => i !== idx).map((p, newIdx) => ({ ...p, pageIndex: newIdx }));
      rebuildSpreads();
      repaintBook();
      updateSelectionHighlight();
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/pages/${idx}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`delete ${res.status}`);
      } catch {
        // 服务端没删掉,本地不能装作删了 —— 回滚到旧引用重绘(同 reorder 失败口径)。
        pagesState = prev;
        rebuildSpreads();
        repaintBook();
        alert(t('deletePageFailed'));
      }
    }
```

(`getTemplate` 的返回对象若无 `spread` 字段类型,查 `packages/contracts/src/templates.ts` 的模板类型 —— `spread?: boolean` 在契约里,直接可读。)

- [ ] **Step 5: 接线守卫测试** — 新建 `delete-page-wiring.test.ts`(镜像 `page-reorder-wiring.test.ts` 的读源码断言式):

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 删除书页(2026-08-03 设计)的接线守卫。服务层对错在 album-service.test.ts;
   这里 pin 接线上的共存条件:
     · 每端恰好一个 DELETE 发射点,失败都回滚本地并提示
     · 两端都有「非内页拒绝 + 最后一张内页拒绝」双守卫(服务端之外的前置反馈)
     · 翻面提示按 spread 条件分叉(双宽页不提示)
     · 移动端删除格 = 确认弹窗,不是点了就删 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const editView = read('mobile', 'EditView.tsx');

test('桌面:入口在选中页气泡(page 组),恰好一个 DELETE 发射点,失败回滚', () => {
  assert.match(editor, /data-edit-action="delete-page"/);
  assert.match(editor, /if \(action === 'delete-page'\)/);
  const deletes = editor.match(/method: 'DELETE'/g) ?? [];
  assert.equal(deletes.length, 1, '桌面只允许 deleteSelectedPage 一个 DELETE 发射点');
  assert.match(editor, /deletePageFailed/);
  assert.match(editor, /deletePageAnchored/);
  assert.match(editor, /deletePageLast/);
  assert.match(editor, /deletePageFlipNote/, '普通内页删除要带翻面提示');
});

test('移动端:确认弹窗后才删,恰好一个 DELETE 发射点,失败回滚', () => {
  assert.match(mobileRoot, /data-testid="delete-page-confirm"/, '删除要过确认弹窗');
  assert.match(mobileRoot, /data-testid="delete-page-confirm-btn"/);
  const deletes = mobileRoot.match(/method: 'DELETE'/g) ?? [];
  assert.equal(deletes.length, 1, '移动端只允许 commitDeletePage 一个 DELETE 发射点');
  assert.match(mobileRoot, /页面没有删掉/, '失败回滚提示');
  assert.match(mobileRoot, /封面、目录和封底不能删除/);
  assert.match(mobileRoot, /最后一张内页/);
  assert.match(mobileRoot, /spread/, '翻面提示按 spread 条件分叉');
  assert.match(editView, /aria-disabled/, '非内页删除格置灰(仍可点,toast 说明原因)');
});

test('两端都退出被删页的选中/编辑态(不能停留在错位引用上)', () => {
  assert.match(editor, /selectedPageIndex = null;[\s\S]{0,200}?hideElementToolbar\(\)/);
  assert.match(mobileRoot, /setEditPage\(null\);[\s\S]{0,120}?setSelection\(null\)/);
});
```

- [ ] **Step 6: 跑测试确认通过** — Run: `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/delete-page-wiring.test.ts` + `pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/page-reorder-wiring.test.ts`(确认没把 reorder 的「每端一个 fetch 点」守卫弄破 —— 它数的是 `pages\/reorder`,DELETE 不影响)+ `pnpm --filter @yujee/web typecheck`;Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/album/editor-v2/EditorPort.tsx apps/web/src/components/album/editor-v2/editor-coordinator.ts apps/web/src/components/album/editor-v2/delete-page-wiring.test.ts
git commit -m "feat(web): 桌面端删除书页入口(选中页气泡)+ 双端接线守卫

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + 文档收口

**Files:**
- Modify: 视 `pnpm docs:check` 输出而定(预期:`CLAUDE.md`、`apps/web/README.md` 的 doc-scope `checked-at` 需推进;只处理**本计划提交**触发的条目,并行会话触发的不代人核对)

**Interfaces:**
- Consumes: Task 1-4 的全部提交
- Produces: 绿色的 `cd apps/web && pnpm test` + 仓根 `pnpm typecheck`(内含 docs:check / templates:check)

- [ ] **Step 1: Web 全包测试** — Run: `cd apps/web && pnpm test`;Expected: PASS(在途并行工作若引入无关红灯,记录并绕开,不在本计划修)
- [ ] **Step 2: docs:check 收口** — Run: `pnpm docs:check`。对**本计划提交**触发的过期条目:重读该文档与本计划改动的关系,内容需要改就改(如 `apps/web/README.md` 若列了 pages 路由面,补 `DELETE`),不需要改也要把 `checked-at` 推进到本计划最后一次提交;并行会话触发的条目原样留下。
- [ ] **Step 3: 仓根 typecheck** — Run: `pnpm typecheck`;Expected: PASS(若 docs:check 仍报并行会话的条目,在汇报里说明,不代人核对)
- [ ] **Step 4: Commit(如有文档改动)**

```bash
git add <docs:check 触发的文档>
git commit -m "docs: 删除书页 Phase 1 文档收口

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 汇报** — 逐条对照规格「测试」节勾验收;声明 Phase 2 未做及其前置(拆表 Task 6)。
