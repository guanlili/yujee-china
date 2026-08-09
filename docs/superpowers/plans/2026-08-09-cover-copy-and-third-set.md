# 封面文案修复 + 第三套深色椭圆版式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修好「AI 从不写封面文案」这个 bug，并把四套设计里的第三套换成「深色椭圆封面 + 深底反白亮字内页」。

**Architecture:** 三条独立链路。① engine 侧改 `compose_global` 的标题兜底逻辑和 prompt，让 AI 真正获准写封面文案；② Web 侧改 `design-apply` 的封面组生成（固定顺序、每套绑封底、第三套带配色），并新增一条「深色内页配色」的确定性应用管线，与现有单色 `pageBackground` 管线并存；③ contracts 侧新增椭圆封面模板。页面真相仍是 HTML，所有配色最终烘进页根 style 和 `#accentColor` carrier，不新造机制。

**Tech Stack:** TypeScript（Next.js Web / contracts 包）、Python（FastAPI engine）、node:test（Web/contracts）、pytest（engine）。

## Global Constraints

- 页面真相 = HTML。每页存完整 794×1123 HTML，图片 src 一律 `{{IMG_SRC:slotId}}` token。
- 渲染注册表唯一真相是 `apps/web/src/components/album/web-registry.ts`，不建第二套。
- 模板 JSON 改动后必须跑 `pnpm --filter @yujee/contracts templates:generate`，`templates.generated.ts` 是产物不手改。
- 文字色 carrier 格式：`${slotId}#accentColor`；字体 carrier：`${slotId}#artFont`。
- Web 测试：`cd apps/web && pnpm test`（仓根 `pnpm test` 会先撞 design-agent 环境）。
- Engine 测试：仓根跑 `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests`。
- Engine 异步测试一律 `asyncio.run(...)` 包在同步测试里（仓库没配 asyncio_mode）。
- 封面配色（第三套）：深墨绿 `#12363A`/字 `#F0A4C2`、奶黄 `#F9EDC4`/字 `#1F3A2E`、粉 `#F0A4C2`/字 `#1F3A24`、深蓝 `#0E2A47`/字 `#F1EFE8`。
- 内页配色（第三套）：`#0E2A47`+`#B8FF3C`、`#12363A`+`#F0A4C2`、`#14140F`+`#D4FF3F`，正文一律 `#E8E5DC`。
- 第三套内页**不留白页**，全书内页一律上深底。

## File Structure

| 文件 | 责任 |
| --- | --- |
| `engine/src/workflows/core/compose/handler.py` | `_with_album_title` 只填第一个 title 槽；`compose_global` 接收章的地点/年份 |
| `engine/src/workflows/core/compose/compose_global.md` | prompt：多 title 槽分主副、只用给定时间地点、不许留空 |
| `engine/src/workflows/compose.py` | 从 `req.chapters` 派生 places/years 传给全局批次 |
| `apps/web/src/services/album/album-service.ts` | `buildComposeRequest` 判定默认书名 |
| `apps/web/src/lib/design/third-set-palette.ts` | **新建**：第三套的封面 4 色 + 内页 3 组配色常量 |
| `apps/web/src/services/album/design-apply.ts` | 固定顺序、每套绑封底、`sweepCarriers` 支持逐页色、深色内页管线 |
| `apps/web/src/services/job/job-service.ts` | compose 回调把 colorway 透传进组页 |
| `apps/web/src/app/api/v3/albums/[uuid]/design/route.ts` | 请求体接收 `coverColorway` |
| `apps/web/src/components/album/editor-v2/ChatPanel.tsx` | 回执卡读真页文案；第三套选色 UI |
| `packages/contracts/templates/mag-62.json` | **新建**：椭圆封面模板契约 |
| `packages/contracts/src/render/html-templates/mag-62.ts` | **新建**：椭圆封面 HTML |
| `packages/contracts/src/render/html-templates/registry.ts` | 注册 mag-62 |

---

### Task 1: engine —— 相册标题只填第一个 title 槽

**Files:**
- Modify: `engine/src/workflows/core/compose/handler.py:440-446`
- Test: `engine/tests/test_compose.py`

**Interfaces:**
- Consumes: 无
- Produces: `compose_global` 的 `cover_texts` 里，多个 `role=title` 槽不再被灌成同一句

- [ ] **Step 1: 写失败测试**

在 `engine/tests/test_compose.py` 末尾加：

```python
def test_album_title_only_fills_the_first_title_slot(monkeypatch):
    """mag-23 有 title/title2 两个 title 槽,旧实现灌成同一个书名重复两遍。"""

    async def boom(**kwargs):
        raise RuntimeError("gemini down")

    slots = [
        {"id": "title", "role": "title", "sample": "NORWAY"},
        {"id": "title2", "role": "title", "sample": "Record"},
    ]
    result = _run_global(
        monkeypatch, boom, language="en", album_title="Summer by the Sea", cover_slots=slots
    )
    assert result.cover_texts["title"] == "Summer by the Sea"
    assert result.cover_texts["title2"] == ""
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_compose.py::test_album_title_only_fills_the_first_title_slot -v`
Expected: FAIL —— `title2` 实际是 `'Summer by the Sea'`

- [ ] **Step 3: 改实现**

把 `handler.py` 的 `_with_album_title` 整体替换为：

```python
    def _with_album_title(cover_texts: dict[str, str]) -> dict[str, str]:
        # 封面标题兜底:模型没写/失败时,**只**给第一个 role=title 的槽填相册标题。
        # 旧实现给所有 title 槽都灌同一句 —— mag-23 有 title/title2 两个槽,封面上
        # 会出现同一个书名重复两遍。副标题槽宁可空着,也不重复主标题。
        if not album_title:
            return cover_texts
        for slot in cover_slots:
            if slot.get("role") != "title":
                continue
            if not cover_texts.get(slot["id"]):
                cover_texts[slot["id"]] = album_title
            break
        return cover_texts
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_compose.py -v`
Expected: 全绿（含既有的 `test_global_failure_falls_back_to_defaults_and_album_title`）

- [ ] **Step 5: 提交**

```bash
git add engine/src/workflows/core/compose/handler.py engine/tests/test_compose.py
git commit -m "fix(compose): 相册标题只兜第一个 title 槽,副标题不再重复主标题"
```

---

### Task 2: engine —— 全局批次拿到各章的地点和年份

**Files:**
- Modify: `engine/src/workflows/core/compose/handler.py:414-423,459-469`
- Modify: `engine/src/workflows/compose.py:199-211`
- Test: `engine/tests/test_compose.py`

**Interfaces:**
- Consumes: Task 1 的 `_with_album_title`
- Produces: `compose_global(..., chapter_places: list[str], chapter_years: list[str])`；载荷里每章多 `place` 和 `years` 两个键

- [ ] **Step 1: 写失败测试**

```python
def test_global_payload_carries_place_and_years(monkeypatch):
    """封面的年份/地名槽要有据可写,否则模型按「不许编造」规则弃权、sample 上书。"""
    seen: dict = {}

    async def fake_generate(**kwargs):
        seen["messages"] = kwargs["messages"]
        return _gemini_response('{"scene":"清新","coverTexts":{},"endingTexts":{}}')

    _run_global(
        monkeypatch,
        fake_generate,
        chapter_titles=["糖色"],
        chapter_contexts=["海边度假"],
        chapter_places=["杭州"],
        chapter_years=["2024"],
    )
    payload = json.loads(seen["messages"][1]["content"])
    assert payload["chapters"][0]["place"] == "杭州"
    assert payload["chapters"][0]["years"] == ["2024"]
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_compose.py::test_global_payload_carries_place_and_years -v`
Expected: FAIL —— `compose_global() got an unexpected keyword argument 'chapter_places'`

- [ ] **Step 3: 改 handler 签名和载荷**

`handler.py` 的 `compose_global` 签名加两个参数（放在 `chapter_contexts` 之后）：

```python
    chapter_places: list[str] | None = None,
    chapter_years: list[str] | None = None,
```

把载荷里 `chapters` 那段替换为：

```python
            # 章标题/背景/地点/年份按章序对位;长度不齐时缺的补空(不因为对不齐就整段不发)。
            "chapters": [
                {
                    "title": title or "",
                    "chapterContext": context or "",
                    "place": place or "",
                    "years": years or [],
                }
                for title, context, place, years in zip_longest(
                    chapter_titles,
                    chapter_contexts,
                    chapter_places or [],
                    chapter_years or [],
                    fillvalue="",
                )
            ],
```

注意 `years` 的 `fillvalue` 会是 `""`，在字典里用 `years or []` 归一成空列表。

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_compose.py::test_global_payload_carries_place_and_years -v`
Expected: PASS

- [ ] **Step 5: 在 compose.py 把真实数据接上**

在 `engine/src/workflows/compose.py` 的 `_global_task_inner` 上方加两个纯函数：

```python
def _chapter_place(chapter) -> str:
    """本章第一张有 place 的照片的地点;没有就空串。"""
    for photo in getattr(chapter, "photos", None) or []:
        place = getattr(photo, "place", None)
        if place:
            return str(place)
    return ""


def _chapter_years(chapter) -> list[str]:
    """本章照片出现过的年份(按首次出现排序,去重)。takenAt 可能是 str 或 datetime,
    两者的字符串前四位都是年份。"""
    years: list[str] = []
    for photo in getattr(chapter, "photos", None) or []:
        taken = getattr(photo, "takenAt", None)
        if not taken:
            continue
        year = str(taken)[:4]
        if year.isdigit() and year not in years:
            years.append(year)
    return years
```

再把 `_global_task_inner` 里的调用补两行：

```python
                chapter_contexts=[chapter.chapterContext for chapter in req.chapters],
                chapter_places=[_chapter_place(chapter) for chapter in req.chapters],
                chapter_years=[_chapter_years(chapter) for chapter in req.chapters],
```

- [ ] **Step 6: 跑全量 engine 测试**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests -q`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
git add engine/src/workflows/core/compose/handler.py engine/src/workflows/compose.py engine/tests/test_compose.py
git commit -m "feat(compose): 全局批次带上各章地点与年份,封面年份/地名槽有据可写"
```

---

### Task 3: engine —— prompt 三处改写

**Files:**
- Modify: `engine/src/workflows/core/compose/compose_global.md`
- Test: `engine/tests/test_prompt_structure.py`

**Interfaces:**
- Consumes: Task 2 的 `place` / `years` 载荷键
- Produces: 无代码接口，只改 prompt 文本

- [ ] **Step 1: 写失败测试**

在 `engine/tests/test_prompt_structure.py` 末尾加：

```python
def test_compose_global_prompt_states_new_rules():
    """三条硬规则必须在 prompt 里:多 title 槽分主副、只用给定时间地点、不许留空。"""
    from pathlib import Path

    text = Path("engine/src/workflows/core/compose/compose_global.md").read_text("utf-8")
    assert "副标题" in text
    assert "years" in text and "place" in text
    assert "不许留空" in text
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_prompt_structure.py::test_compose_global_prompt_states_new_rules -v`
Expected: FAIL

- [ ] **Step 3: 改 prompt**

`compose_global.md` 的「输入」段，把 `chapters` 那条替换为：

```markdown
- `chapters`:每章一条 `{title, chapterContext, place, years}`。title 是各章文案里的章标题,
  chapterContext 是用户自己讲的章节背景,place 是这一章照片拍摄的地点,years 是这一章
  照片出现过的年份 —— 提炼全书的情绪和主题靠前两个,写年份/地名类的槽用后两个。
```

「规则(硬性)」段，把第 1 条和「不要编造」那条替换为：

```markdown
- 每个槽都要写,**不许留空**;role=title 短而有画面感,不空洞;role=body/explain 一两句,
  第一人称回忆口吻。
- **多个 title 槽**:第一个是主标题,后面的是副标题 —— 各写各的,**绝不重复同一句**。
- 时间和地点**只能用 `chapters` 里给出的 `place` 和 `years`**,不要自己编。给出的信息
  不够填满这个槽时,就写一句不含具体时间地点的话顶上 —— 但**不能留空**,空槽会让版面
  掉回模板示例文案(那是别人的年份和地名,印在用户书上比空着更糟)。
- 不要编造人名。
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests/test_prompt_structure.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add engine/src/workflows/core/compose/compose_global.md engine/tests/test_prompt_structure.py
git commit -m "fix(compose): prompt 三条硬规则 —— 多 title 分主副、只用给定时地、不许留空"
```

---

### Task 4: Web —— 默认书名不当成用户书名传给 AI

**Files:**
- Modify: `apps/web/src/services/album/album-service.ts:325-334`
- Test: `apps/web/src/services/album/album-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 engine 行为（albumTitle 为空 → AI 自己写标题）
- Produces: `DEFAULT_ALBUM_TITLES` 常量导出，供测试和后续复用

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/services/album/album-service.test.ts` 末尾加：

```typescript
import { isDefaultAlbumTitle } from './album-service';

test('isDefaultAlbumTitle: 系统默认书名视为「用户没起名」', () => {
  assert.equal(isDefaultAlbumTitle('My Memoir'), true);
  assert.equal(isDefaultAlbumTitle('我的故事'), true);
  assert.equal(isDefaultAlbumTitle('  My Memoir  '), true);
  assert.equal(isDefaultAlbumTitle('海边那年'), false);
  assert.equal(isDefaultAlbumTitle(''), true);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A3 isDefaultAlbumTitle`
Expected: FAIL —— 找不到导出

- [ ] **Step 3: 实现并接进 buildComposeRequest**

在 `album-service.ts` 里 `buildComposeRequest` 上方加：

```typescript
// 相册默认标题(generation-service.ts:61 的兜底值)。它不是用户起的书名 ——
// 传给 compose 会被 prompt 当成「用户自己定的书名,原样使用」,导致封面大标题恒为
// My Memoir、AI 从来没机会写封面标题。判定为默认就传空串,让 AI 自己起。
export const DEFAULT_ALBUM_TITLES = ['My Memoir', '我的故事'] as const;

export function isDefaultAlbumTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim();
  return t === '' || DEFAULT_ALBUM_TITLES.some((d) => d === t);
}
```

把 `buildComposeRequest` 里的 `albumTitle` 一行替换为：

```typescript
    albumTitle: isDefaultAlbumTitle(input.albumTitle) ? '' : input.albumTitle.slice(0, 120),
```

同时把 `applyDesign` 里传进来的那一行（`album-service.ts:1280`）保持原样 —— 归一化在
`buildComposeRequest` 里做，只此一处。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/services/album/album-service.ts apps/web/src/services/album/album-service.test.ts
git commit -m "fix(design): 默认书名不再冒充用户书名,封面标题交还给 AI"
```

---

### Task 5: Web —— 非标题槽不再回落模板 sample

**Files:**
- Modify: `apps/web/src/services/album/design-apply.ts:70-78`
- Modify: `apps/web/src/services/job/job-service.ts:233-234`
- Test: `apps/web/src/services/album/design-apply.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `coverTextBase(templateId): Record<string, string>` —— 只含 `role=title` 槽的 sample

- [ ] **Step 1: 写失败测试**

```typescript
test('coverTextBase: 只给 title 槽留 sample 兜底,其余槽宁可空着', () => {
  const base = coverTextBase('mag-23');
  assert.equal(base.title, 'NORWAY');
  assert.equal(base.body, undefined);   // sample 是 "2026\n2025\n2024",别人的年份
  assert.equal(base.body2, undefined);  // sample 是 "Shanghai \nBeijing\nDali"
});
```

并把 import 补上 `coverTextBase`。

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A3 coverTextBase`
Expected: FAIL —— 找不到导出

- [ ] **Step 3: 实现**

在 `design-apply.ts` 的 `sampleTexts` 下方加：

```typescript
/**
 * 封面/封尾文案的兜底底稿:**只**保留 role=title 槽的 sample。
 *
 * 其余槽（body/explain/decoration）宁可空着 —— 那些槽的 sample 是模板作者写的
 * 具体年份和地名（mag-23 的 "2026\n2025\n2024" / "Shanghai \nBeijing\nDali"），
 * 模型没写出来时回落 sample 等于把别人的年份地名印在用户的书上，比空着更糟。
 * 标题槽例外:封面没有大标题是废版面，必须留兜底。
 */
export function coverTextBase(templateId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of templateOf(templateId)?.texts ?? []) {
    if (slot.role !== 'title') continue;
    const sample = (slot as { sample?: unknown }).sample;
    if (typeof sample === 'string' && sample !== '') out[slot.id] = sample;
  }
  return out;
}
```

在 `job-service.ts` 把两行 `sampleTexts(...)` 换成 `coverTextBase(...)`，并把 import
里的 `sampleTexts` 换成 `coverTextBase`：

```typescript
    coverTexts: mergeSlotTexts(coverTextBase(meta.coverTemplateId), payload.coverTexts),
    endingTexts: mergeSlotTexts(coverTextBase(meta.endingTemplateId), payload.endingTexts),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿。若 `job-service` 相关测试断言了 sample 回落，按新口径改断言。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/services/album/design-apply.ts apps/web/src/services/album/design-apply.test.ts apps/web/src/services/job/job-service.ts
git commit -m "fix(design): 封面非标题槽不再回落 sample,不把别人的年份地名印上书"
```

---

### Task 6: Web —— 回执卡显示真页文案

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/ChatPanel.tsx:630-696`
- Modify: `apps/web/src/components/album/editor-v2/editor-coordinator.ts:50`
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx:4981-5001`
- Modify: `apps/web/src/components/album/editor-v2/mobile/use-chat-coordinator.ts:93`
- Test: `apps/web/src/components/album/editor-v2/theme-cover-cards-wiring.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `coverOptionHTML(templateId, photoId, boxW?, boxH?, pageBackground?, texts?)` —— 末位新增可选 `texts`

- [ ] **Step 1: 写失败测试**

在 `theme-cover-cards-wiring.test.ts` 末尾加：

```typescript
test('appendCoverSummary 把真页 textsJson 传给 coverOptionHTML(回执卡不再显示模板 sample)', () => {
  const fn = /function appendCoverSummary\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'appendCoverSummary must exist');
  assert.match(fn![0], /coverTexts:\s*coverPage\?\.textsJson/);
  assert.match(fn![0], /endingTexts:\s*endingPage\?\.textsJson/);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A3 "回执卡不再显示"`
Expected: FAIL

- [ ] **Step 3: 给 coverOptionHTML 加 texts 入参**

`EditorPort.tsx` 的 `coverOptionHTML`：

```typescript
    function coverOptionHTML(
      templateId: string,
      photoId: string | null,
      boxW = 132,
      boxH = 176,
      pageBackground?: string,
      texts?: Record<string, string>,
    ): string {
      const page: EditorPage = {
        pageIndex: 0,
        templateId,
        imagesJson: photoId ? { [heroSlotId(templateId)]: photoId } : {},
        // 选择卡传空(那时还没文案,渲模板 sample 是对的);回执卡传真页 textsJson。
        textsJson: texts ?? {},
      };
```

`editor-coordinator.ts:50` 的类型同步加 `texts?: Record<string, string>`。
`use-chat-coordinator.ts:93` 的转发函数同步加末位参数并透传。

- [ ] **Step 4: 让回执卡传真文案**

`ChatPanel.tsx` 的 `buildCoverRecapCard` 入参对象加两个可选字段，并在两处
`coverOptionHTML` 调用末位透传：

```typescript
    function buildCoverRecapCard(set: {
      coverTemplateId: string | null;
      coverPhotoId: string | null;
      endingTemplateId: string | null;
      endingPhotoId: string | null;
      coverTexts?: Record<string, string>;
      endingTexts?: Record<string, string>;
    }, pageBackground?: string): HTMLElement {
```

```typescript
          `<span class="cv-face">${co()?.coverOptionHTML?.(set.coverTemplateId, set.coverPhotoId, 92, 122, pageBackground, set.coverTexts) ?? ''}` +
```

```typescript
          `<span class="cv-face">${co()?.coverOptionHTML?.(set.endingTemplateId, set.endingPhotoId, 92, 122, pageBackground, set.endingTexts) ?? ''}` +
```

`appendCoverSummary` 里补两行：

```typescript
        buildCoverRecapCard({
          coverTemplateId: coverPage?.templateId ?? null,
          coverPhotoId: coverPage ? (Object.values(coverPage.imagesJson)[0] ?? null) : null,
          endingTemplateId: endingPage?.templateId ?? null,
          endingPhotoId: endingPage ? (Object.values(endingPage.imagesJson)[0] ?? null) : null,
          coverTexts: coverPage?.textsJson,
          endingTexts: endingPage?.textsJson,
        }, bgOfPage(coverPage) ?? bgOfPage(endingPage)),
```

`runApplyDesign` 里那次实时调用（`ChatPanel.tsx:1831`）**不传** texts —— 那一刻文案还没
写出来，渲 sample 是诚实的；成稿完成后 `waitForComposeThenRefresh` 会重建回执卡。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/album/editor-v2/
git commit -m "fix(editor): 已选封面回执卡显示真页文案,不再恒渲模板 sample"
```

---

### Task 7: contracts —— 椭圆挖空封面模板 mag-62

**Files:**
- Create: `packages/contracts/templates/mag-62.json`
- Create: `packages/contracts/src/render/html-templates/mag-62.ts`
- Modify: `packages/contracts/src/render/html-templates/registry.ts`
- Modify: `apps/web/src/components/album/web-registry.ts`

**Interfaces:**
- Consumes: 无
- Produces: 模板 id `mag-62`，`category: 'cover'`，图槽 `image`，文字槽 `title` / `explain` / `label` / `label2` / `label3`

- [ ] **Step 1: 写模板 JSON**

`packages/contracts/templates/mag-62.json`：

```json
{
  "id": "mag-62",
  "category": "cover",
  "images": [
    { "id": "image", "orientation": ["portrait"], "quality": ["hero"], "composition": ["focal", "closeup"] }
  ],
  "texts": [
    { "id": "title", "role": "title", "sample": "海边那年" },
    { "id": "explain", "role": "explain", "sample": "The Year We Walked the Shore" },
    { "id": "label", "role": "decoration", "sample": "Yujee Collection ①" },
    { "id": "label2", "role": "decoration", "sample": "yujee" },
    { "id": "label3", "role": "decoration", "sample": "2026 年记" }
  ]
}
```

- [ ] **Step 2: 写 HTML 模板**

`packages/contracts/src/render/html-templates/mag-62.ts`：

```typescript
// mag-62 HTML 模板(椭圆挖空封面)。几何按参照书封等比换算到 794×1123:
// 胶囊照片框 212×402(圆角 106 = 宽的一半,两端全圆)、left 291 水平居中、top 366。
// 底色与文字色由 design-apply 的第三套配色在页根 style 上覆盖(background-color/color),
// 模板自带的是深墨绿默认配色。
const SANS_EN = '&quot;Work Sans&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';
const SERIF_EN = '&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif';

export const MAG_62_HTML = `<div data-template="mag-62" style="position:relative;width:794px;height:1123px;background:#12363A;color:#E7E3D8;overflow:hidden;box-sizing:border-box;font-family:${SANS_EN}">
  <div data-text-key="title" style="position:absolute;left:70px;top:118px;width:654px;text-align:center;font-family:{{FONT:title|${SERIF_EN}}};font-size:52px;line-height:1.2;letter-spacing:3px;color:{{COLOR:title|#F0A4C2}}">{{TEXT:title}}</div>
  <div data-text-key="explain" style="position:absolute;left:70px;top:196px;width:654px;text-align:center;font-family:{{FONT:explain|${SERIF_EN}}};font-size:22px;line-height:1.4;letter-spacing:0.6px;color:{{COLOR:explain|#E7E3D8}}">{{TEXT:explain}}</div>
  <div data-image-slot="image" style="position:absolute;left:291px;top:366px;width:212px;height:402px;border-radius:106px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:{{IMG_POS:image|50% 50%}};{{IMG_TF:image}}" />
  </div>
  <div data-text-key="label" style="position:absolute;left:664px;top:400px;width:334px;transform:rotate(90deg);transform-origin:0 0;font-family:{{FONT:label|${SANS_EN}}};font-size:15px;letter-spacing:2.4px;color:{{COLOR:label|#E7E3D8}}">{{TEXT:label}}</div>
  <div data-text-key="label2" style="position:absolute;left:70px;bottom:78px;font-family:{{FONT:label2|${SERIF_EN}}};font-size:24px;letter-spacing:1px;color:{{COLOR:label2|#E7E3D8}}">{{TEXT:label2}}</div>
  <div data-text-key="label3" style="position:absolute;right:70px;bottom:74px;text-align:right;font-family:{{FONT:label3|${SANS_EN}}};font-size:15px;line-height:1.7;letter-spacing:1px;color:{{COLOR:label3|#E7E3D8}}">{{TEXT:label3}}</div>
</div>`;
```

**注意**：`&quot;` 必须原样保留 —— 它在双引号包裹的 style 属性内，解码成真引号会截断属性、
font-family 整段失效。

- [ ] **Step 3: 注册（两处）**

`packages/contracts/src/render/html-templates/registry.ts` —— 在 `:53` 的
`import { MAG_61_HTML } from './mag-61';` 之后加：

```typescript
import { MAG_62_HTML } from './mag-62';
```

在 `:104` 的 `'mag-61': MAG_61_HTML,` 之后加：

```typescript
  'mag-62': MAG_62_HTML,
```

`apps/web/src/components/album/web-registry.ts` —— 在 `:56` 的
`import { WebMag61 } from './templates/mag-61';` 之后加同形 import，`:58` 的
`'mag-61': WebMag61,` 之后加 `'mag-62': WebMag62,`，并新建
`apps/web/src/components/album/templates/mag-62/index.tsx`。React 版只是 HTML 模板缺失时
的回退，几何直接镜像 `MAG_62_HTML`，参照同目录 `mag-61/index.tsx` 的写法。

- [ ] **Step 4: 生成契约产物并校验**

Run:
```bash
pnpm --filter @yujee/contracts templates:generate
pnpm --filter @yujee/contracts templates:check
pnpm --filter @yujee/contracts test
```
Expected: 全绿；`templates.generated.ts` 里出现 mag-62

- [ ] **Step 5: 截图验证外观**

用 `docs` 里记的截图法（模板串灌 JSON sample、图槽用色块 data URI、`@font-face` 指相对
路径的 `apps/web/public/fonts/*.ttf`、headless Chrome `--screenshot --window-size=794,1123`），
出图对照 `~/Desktop/椭圆挖空封面-预览.html` 的深墨绿版。两者应逐像素同构。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts/templates/mag-62.json packages/contracts/src/render/html-templates/ packages/contracts/src/templates.generated.ts apps/web/src/components/album/web-registry.ts
git commit -m "feat(templates): 加 mag-62 —— 椭圆挖空封面(胶囊照片框 212x402)"
```

---

### Task 8: Web —— 第三套配色常量

**Files:**
- Create: `apps/web/src/lib/design/third-set-palette.ts`
- Test: `apps/web/src/lib/design/third-set-palette.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type CoverColorway = { id: string; name: string; nameEn: string; bg: string; title: string; sub: string }`
  - `THIRD_SET_COVERS: readonly CoverColorway[]`（4 个）
  - `type DarkInk = { id: string; bg: string; accent: string; body: string }`
  - `THIRD_SET_INTERIOR: readonly DarkInk[]`（3 个）
  - `coverColorwayById(id: string): CoverColorway | undefined`
  - `THIRD_SET_COVER_TEMPLATE_ID = 'mag-62'`

- [ ] **Step 1: 写失败测试**

`apps/web/src/lib/design/third-set-palette.test.ts`：

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THIRD_SET_COVERS,
  THIRD_SET_INTERIOR,
  coverColorwayById,
  THIRD_SET_COVER_TEMPLATE_ID,
} from './third-set-palette';

const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('封面 4 个配色,深墨绿+粉字是第一个', () => {
  assert.equal(THIRD_SET_COVERS.length, 4);
  assert.equal(THIRD_SET_COVERS[0]!.bg, '#12363A');
  assert.equal(THIRD_SET_COVERS[0]!.title, '#F0A4C2');
  assert.equal(THIRD_SET_COVER_TEMPLATE_ID, 'mag-62');
});

test('封面每个配色的标题对比度 >= 4.5:1(大字号也不将就)', () => {
  for (const c of THIRD_SET_COVERS) {
    assert.ok(contrast(c.title, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
    assert.ok(contrast(c.sub, c.bg) >= 4.5, `${c.id} 副标对比度不足`);
  }
});

test('内页 3 组深底配色,正文与亮字对比度都达标', () => {
  assert.equal(THIRD_SET_INTERIOR.length, 3);
  for (const c of THIRD_SET_INTERIOR) {
    assert.ok(contrast(c.body, c.bg) >= 4.5, `${c.id} 正文对比度不足`);
    assert.ok(contrast(c.accent, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
  }
});

test('coverColorwayById: 认识的返回,不认识的 undefined', () => {
  assert.equal(coverColorwayById('teal')?.bg, '#12363A');
  assert.equal(coverColorwayById('nope'), undefined);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A3 third-set`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

```typescript
// 第三套(深色椭圆)的配色真相源。封面色和内页色**分开管** —— 封面是一整张
// 视觉主张,内页要顾及照片和长段落阅读,两者约束不同,不共用一张色表。
// 所有色值都过了对比度实测(见同目录 .test.ts),改色必须同步跑测试。

export const THIRD_SET_COVER_TEMPLATE_ID = 'mag-62';

export type CoverColorway = {
  id: string;
  name: string;
  nameEn: string;
  bg: string;
  /** 主标题色 */
  title: string;
  /** 副标题 / 竖排系列名 / 底部署名色 */
  sub: string;
};

export const THIRD_SET_COVERS: readonly CoverColorway[] = [
  { id: 'teal', name: '深墨绿', nameEn: 'Deep Teal', bg: '#12363A', title: '#F0A4C2', sub: '#E7E3D8' },
  { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
  { id: 'pink', name: '粉', nameEn: 'Pink', bg: '#F0A4C2', title: '#1F3A24', sub: '#3A2B31' },
  { id: 'navy', name: '深蓝', nameEn: 'Navy', bg: '#0E2A47', title: '#F1EFE8', sub: '#C9D3DE' },
];

export const DEFAULT_COVER_COLORWAY_ID = THIRD_SET_COVERS[0]!.id;

export function coverColorwayById(id: string | null | undefined): CoverColorway | undefined {
  if (!id) return undefined;
  return THIRD_SET_COVERS.find((c) => c.id === id);
}

/** 内页深底配色。accent 给 title/decoration,body 给 body/explain。 */
export type DarkInk = { id: string; bg: string; accent: string; body: string };

// 荧光绿/黄绿是真荧光色,四色印刷印不出来,需专色油墨(Pantone Neon / Riso 荧光墨);
// 不加专色时实体书上会偏闷。这是已知并接受的代价,见 spec 三.3。
export const THIRD_SET_INTERIOR: readonly DarkInk[] = [
  { id: 'navy-lime', bg: '#0E2A47', accent: '#B8FF3C', body: '#E8E5DC' },
  { id: 'teal-pink', bg: '#12363A', accent: '#F0A4C2', body: '#E8E5DC' },
  { id: 'ink-lime', bg: '#14140F', accent: '#D4FF3F', body: '#E8E5DC' },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/design/third-set-palette.ts apps/web/src/lib/design/third-set-palette.test.ts
git commit -m "feat(design): 第三套配色真相源(封面 4 色 + 内页 3 组),带对比度守卫测试"
```

---

### Task 9: Web —— 封面组固定顺序 + 每套绑封底 + 第三套标记

**Files:**
- Modify: `apps/web/src/services/album/design-apply.ts:11-19,131-164`
- Test: `apps/web/src/services/album/design-apply.test.ts:23-49`

**Interfaces:**
- Consumes: Task 8 的 `THIRD_SET_COVER_TEMPLATE_ID`
- Produces: `CoverSet` 新增 `endingTemplateId` 逐套不同 + 可选 `colorways?: readonly CoverColorway[]`；`buildCoverSets` 不再依赖 albumId 轮换

- [ ] **Step 1: 写失败测试**

替换 `design-apply.test.ts` 里 `buildCoverSets` 的两条既有测试为：

```typescript
test('buildCoverSets: 固定顺序,第 3 套是椭圆封面,不随 albumId 变', () => {
  const a = buildCoverSets('album-1', CHAPTERS);
  const b = buildCoverSets('album-2', CHAPTERS);
  assert.equal(a.length, 4);
  assert.deepEqual(a.map((s) => s.coverTemplateId), b.map((s) => s.coverTemplateId));
  assert.equal(a[2]!.coverTemplateId, 'mag-62');
});

test('buildCoverSets: 只有第 3 套带 colorways,其余套走白灰底色', () => {
  const sets = buildCoverSets('album-1', CHAPTERS);
  assert.equal(sets[2]!.colorways?.length, 4);
  assert.equal(sets[0]!.colorways, undefined);
  assert.equal(sets[0]!.pageBackground, '#FFFFFF');
});

test('buildCoverSets: 封底逐套显式声明(SET_LAYOUT 表),不再按 albumId 哈希', () => {
  const a = buildCoverSets('album-1', CHAPTERS);
  const b = buildCoverSets('album-2', CHAPTERS);
  assert.deepEqual(a.map((s) => s.endingTemplateId), b.map((s) => s.endingTemplateId));
  for (const s of a) assert.equal(templateCategory(s.endingTemplateId), 'ending');
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A5 buildCoverSets`
Expected: FAIL

- [ ] **Step 3: 实现**

`design-apply.ts` 顶部补 import：

```typescript
import {
  THIRD_SET_COVERS,
  THIRD_SET_COVER_TEMPLATE_ID,
  THIRD_SET_INTERIOR,
  type CoverColorway,
} from '@/lib/design/third-set-palette';
```

`CoverSet` 类型加一个可选字段：

```typescript
  /** 第三套(深色椭圆)专有:用户选中这一套后再挑一个配色。其余套不带。 */
  colorways?: readonly CoverColorway[];
```

把 `buildCoverSets` 整体替换为：

```typescript
// 四套固定顺序,不再按 albumId 轮换 —— 「第三套是深色椭圆」这个约定必须对每本书都成立,
// 轮换会让第 3 位在不同相册指向不同模板。每套一对一绑自己的封底。
const SET_LAYOUT: ReadonlyArray<{ cover: string; ending: string }> = [
  { cover: 'mag-01', ending: 'mag-22' },
  { cover: 'mag-23', ending: 'mag-22' },
  { cover: THIRD_SET_COVER_TEMPLATE_ID, ending: 'mag-22' },
  { cover: 'p01', ending: 'mag-22' },
];

export function buildCoverSets(albumId: string, chapters: TreeChapter[]): CoverSet[] {
  const heroes = pickHeroPhotos(chapters, 2);
  if (heroes.length === 0) return [];
  const coverPhotoId = heroes[0]!;
  const endingPhotoId = heroes.find((id) => id !== coverPhotoId) ?? coverPhotoId;
  return SET_LAYOUT.filter(
    (s) => templateCategory(s.cover) === 'cover' && templateCategory(s.ending) === 'ending',
  ).map((s, i) => ({
    coverTemplateId: s.cover,
    coverPhotoId,
    endingTemplateId: s.ending,
    endingPhotoId,
    pageBackground: PAGE_BACKGROUNDS[i % PAGE_BACKGROUNDS.length]!.hex,
    ...(s.cover === THIRD_SET_COVER_TEMPLATE_ID ? { colorways: THIRD_SET_COVERS } : {}),
  }));
}
```

`pickEndingTemplateId` 保留（`listCoverSets` 之外还有调用方时用得上），但 `buildCoverSets`
不再调它。

> `SET_LAYOUT` 里三个 `mag-22` 是**临时值**：两个新封底版式（Task 13）落地后，第 1/2/4 套
> 各自改成新版式，第 3 套留 mag-22 或换成深色封底。这里显式写死而不是哈希，就是为了那天
> 改起来是改一张表，不是改一个算法。
>
> **⚠️ 待小雨拍板**：封面槽位只有 4 个，加了 mag-62 就得挤掉一个现有封面。这里我先挤掉了
> **mag-32**（它照片占比 87%，四个里留白最少、版面语言和 mag-23 最接近）。要换成挤掉别的，
> 改 `SET_LAYOUT` 一行即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/services/album/design-apply.ts apps/web/src/services/album/design-apply.test.ts
git commit -m "feat(design): 四套固定顺序、每套绑封底,第三套带配色选项"
```

---

### Task 10: Web —— 深色内页配色管线

**Files:**
- Modify: `apps/web/src/services/album/design-apply.ts:183-266`
- Test: `apps/web/src/services/album/design-apply.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `THIRD_SET_INTERIOR`、`CoverColorway`
- Produces: `sweepCarriers(pages, fonts, colors | (page) => DesignColors)`；`assembleDesignedPages` 新增可选入参 `colorway?: CoverColorway`

- [ ] **Step 1: 写失败测试**

```typescript
test('assembleDesignedPages: 带 colorway 时内页按 3 组深底循环,页根刷底色和字色', () => {
  const interior = [0, 1, 2, 3].map((i) => ({
    pageIndex: i,
    templateId: 'mag-08',
    images: {},
    texts: { note: '文' },
  }));
  const pages = assembleDesignedPages({
    interiorPages: interior as never,
    set: {
      coverTemplateId: 'mag-62',
      coverPhotoId: 'p1',
      endingTemplateId: 'mag-22',
      endingPhotoId: 'p2',
    },
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    colorway: { id: 'teal', name: '深墨绿', nameEn: 'Deep Teal', bg: '#12363A', title: '#F0A4C2', sub: '#E7E3D8' },
  });
  // 页序 [封面, 内页×4, 封底];内页从 index 1 开始,按 3 组循环
  assert.match(pages[1]!.html!, /background-color:\s*#0E2A47/i);
  assert.match(pages[2]!.html!, /background-color:\s*#12363A/i);
  assert.match(pages[3]!.html!, /background-color:\s*#14140F/i);
  assert.match(pages[4]!.html!, /background-color:\s*#0E2A47/i); // 循环回第一组
  // 封面/封底用 colorway 的底色
  assert.match(pages[0]!.html!, /background-color:\s*#12363A/i);
  // 深底上正文色翻浅,否则模板根写死的 #1c1b18 会黑压黑
  assert.match(pages[1]!.html!, /color:\s*#E8E5DC/i);
});

test('assembleDesignedPages: 不带 colorway 时行为不变(仍走单色 pageBackground)', () => {
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }] as never,
    set: { coverTemplateId: 'mag-01', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    pageBackground: '#FBF8F1',
  });
  assert.match(pages[1]!.html!, /background-color:\s*#FBF8F1/i);
  assert.doesNotMatch(pages[1]!.html!, /#0E2A47/i);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A5 colorway`
Expected: FAIL —— `colorway` 不是合法入参

- [ ] **Step 3: 让 sweepCarriers 支持逐页色**

```typescript
export function sweepCarriers(
  pages: Page[],
  fonts: DesignFonts,
  colors: DesignColors | ((page: Page) => DesignColors),
): Page[] {
  const fontByRole: Record<string, string> = {
    title: fonts.title,
    body: fonts.body,
    explain: fonts.body,
    decoration: fonts.decoration,
  };
  return pages.map((page) => {
    const template = templateOf(page.templateId);
    if (!template) return page;
    const c = typeof colors === 'function' ? colors(page) : colors;
    const colorByRole: Record<string, string> = {
      title: c.title,
      body: c.body,
      explain: c.explain,
      decoration: c.title,
    };
    const texts = { ...page.texts };
    for (const slot of template.texts ?? []) {
      const font = fontByRole[slot.role];
      const color = colorByRole[slot.role];
      if (font) texts[`${slot.id}${THEME_FONT_CARRIER_SUFFIX}`] = font;
      if (color) texts[`${slot.id}${THEME_ACCENT_CARRIER_SUFFIX}`] = color;
    }
    return { ...page, texts };
  });
}
```

- [ ] **Step 4: 加深色配色解析 + 页根刷色**

在 `applyPageBackground` 上方加：

```typescript
/**
 * 第三套的逐页配色:封面/封尾用用户选的 colorway,内页按 THIRD_SET_INTERIOR 三组
 * **按出现顺序**循环（不按章 —— 章长短不一会让色块忽长忽短）。
 * 深色套不留白页:满版图页染了也基本看不见,但深色书里插一页纯白像漏印,故一律上底色。
 */
function darkInkByPageIndex(
  ordered: Page[],
  colorway: CoverColorway,
): Map<number, { bg: string; accent: string; body: string }> {
  const out = new Map<number, { bg: string; accent: string; body: string }>();
  let i = 0;
  for (const page of ordered) {
    if (templateCategory(page.templateId) === 'interior') {
      const ink = THIRD_SET_INTERIOR[i % THIRD_SET_INTERIOR.length]!;
      out.set(page.pageIndex, { bg: ink.bg, accent: ink.accent, body: ink.body });
      i += 1;
    } else {
      // 封面/封尾:用 colorway,让整本书首尾同色收口
      out.set(page.pageIndex, { bg: colorway.bg, accent: colorway.title, body: colorway.sub });
    }
  }
  return out;
}

/** 页根同时刷底色和默认字色 —— 模板根写死 color:#1c1b18,深底上不翻浅的话,
 *  非 carrier 的静态装饰(页码、斜杠、分隔符)会黑压黑看不见。 */
function applyDarkChrome(
  pages: Page[],
  inkByIndex: Map<number, { bg: string; body: string }>,
): Page[] {
  return pages.map((page) => {
    const ink = inkByIndex.get(page.pageIndex);
    if (!ink || typeof page.html !== 'string') return page;
    const patched = patchHtmlPageStyle(page.html, {
      'background-color': ink.bg,
      color: ink.body,
    });
    return patched ? { ...page, html: patched } : page;
  });
}
```

- [ ] **Step 5: 接进 assembleDesignedPages**

入参加一行：

```typescript
  /** 第三套(深色椭圆)选中的配色;不传 = 走原来的单色 pageBackground 路径。 */
  colorway?: CoverColorway;
```

把结尾三行替换为：

```typescript
  const inkByIndex = input.colorway ? darkInkByPageIndex(ordered, input.colorway) : null;
  const swept = sweepCarriers(ordered, input.fonts, (page) => {
    const ink = inkByIndex?.get(page.pageIndex);
    return ink ? { title: ink.accent, body: ink.body, explain: ink.body } : input.colors;
  });
  const baked = bakePagesHtml(swept.map((page) => ({ ...page, html: undefined }))) as Page[];
  return inkByIndex
    ? applyDarkChrome(baked, inkByIndex)
    : applyPageBackground(baked, input.pageBackground);
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿（既有的「纯白不写 inline bg」「非纯白刷进页根」两条测试仍必须过）

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/services/album/design-apply.ts apps/web/src/services/album/design-apply.test.ts
git commit -m "feat(design): 第三套深色内页管线 —— 逐页循环底色与反白亮字"
```

---

### Task 11: Web —— colorway 从选择卡透传到组页

**Files:**
- Modify: `apps/web/src/app/api/v3/albums/[uuid]/design/route.ts:11-23`
- Modify: `apps/web/src/services/album/album-service.ts:1209-1310`
- Modify: `apps/web/src/services/job/job-service.ts:210-239`
- Modify: `apps/web/src/components/album/editor-v2/ChatPanel.tsx:1695-1882`
- Test: `apps/web/src/services/job/compose-completed.test.ts`（`mergeComposeIntoDraft` 的既有
  测试都在这里，新用例跟着放，别新建文件）

**Interfaces:**
- Consumes: Task 8 `coverColorwayById`、Task 10 `assembleDesignedPages({ colorway })`
- Produces: `POST /design` 请求体新增可选 `coverColorway: string`；`ComposeJobMeta` 新增可选 `coverColorway: string`

- [ ] **Step 1: 写失败测试**

加在 `apps/web/src/services/job/compose-completed.test.ts` 末尾。**复用文件里既有的
`draft()` helper 和 `META` 常量** —— 别自己造 draft 字面量，`V3StoryDraft.safeParse`
对形状有要求，手写的会直接被拒、测试红在无关的地方：

```typescript
test('mergeComposeIntoDraft: meta 带 coverColorway 时内页走深色配色', () => {
  const { draftJson } = mergeComposeIntoDraft(
    draft(),
    { ...META, coverTemplateId: 'mag-62', coverColorway: 'teal' } as ComposeJobMeta,
    {},
  );
  // 页序 [封面, ...内页, 封尾];第一张内页拿 THIRD_SET_INTERIOR[0]
  assert.match(draftJson.pages[1]!.html!, /background-color:\s*#0E2A47/i);
});

test('mergeComposeIntoDraft: 不带 coverColorway 时不写深色底(老书行为不变)', () => {
  const { draftJson } = mergeComposeIntoDraft(draft(), META, {});
  assert.doesNotMatch(draftJson.pages[1]!.html!, /#0E2A47/i);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A5 coverColorway`
Expected: FAIL

- [ ] **Step 3: 契约与服务层透传**

`route.ts` 的 `BodySchema` 加一行（放在 `pageBackground` 之后）：

```typescript
    // 第三套(深色椭圆)选中的配色 id;合法性在 albumService.applyDesign 校验。
    coverColorway: z.string().min(1).optional(),
```

`album-service.ts` 的 `applyDesign` 入参类型加 `coverColorway?: string`，并在
`pageBackground` 校验之后加一条：

```typescript
    if (input.coverColorway && !coverColorwayById(input.coverColorway))
      throw ERRORS.VALIDATION_FAILED(`invalid cover colorway: ${input.coverColorway}`);
```

job meta 那段加一行：

```typescript
              ...(input.coverColorway ? { coverColorway: input.coverColorway } : {}),
```

`applyPlaceholderDesign` 的入参与 meta 同步加同一字段（游客占位书也要能看到深色套）。

`job-service.ts` 的 `ComposeJobMeta` 类型加 `coverColorway?: string`，
`mergeComposeIntoDraft` 里加：

```typescript
    ...(coverColorwayById(meta.coverColorway) ? { colorway: coverColorwayById(meta.coverColorway)! } : {}),
```

- [ ] **Step 4: 前端把选中的配色带上**

`ChatPanel.tsx` 的 `runApplyDesign` 签名加第三个参数并透传进请求体：

```typescript
    async function runApplyDesign(
      set: { coverTemplateId: string; coverPhotoId: string; endingTemplateId: string; endingPhotoId: string; pageBackground?: string },
      pageBackground?: string,
      coverColorway?: string,
    ) {
```

```typescript
          body: JSON.stringify({
            language: currentLang === 'zh' ? 'zh' : 'en',
            ...set,
            ...(pageBackground ? { pageBackground } : {}),
            ...(coverColorway ? { coverColorway } : {}),
            refs,
          }),
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/web && pnpm test 2>&1 | tail -20` 与 `pnpm --filter @yujee/web typecheck`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/api/v3/albums/ apps/web/src/services/album/album-service.ts apps/web/src/services/job/job-service.ts apps/web/src/components/album/editor-v2/ChatPanel.tsx
git commit -m "feat(design): coverColorway 从选择卡透传到成稿组页"
```

---

### Task 12: Web —— 第三套的选色 UI

**Files:**
- Modify: `apps/web/src/components/album/editor-v2/ChatPanel.tsx:1750-1818`
- Modify: `apps/web/src/components/album/editor-v2/editor-port.css:1528-1570`
- Test: `apps/web/src/components/album/editor-v2/theme-cover-cards-wiring.test.ts`

**Interfaces:**
- Consumes: Task 9 的 `set.colorways`、Task 11 的 `runApplyDesign(..., colorway)`
- Produces: 无对外接口

- [ ] **Step 1: 写失败测试**

```typescript
test('选中带 colorways 的那一套时,选择卡里出现一排色点', () => {
  const fn = /async function offerDesignCard\(\)[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'offerDesignCard must exist');
  assert.match(fn![0], /cv-swatches/);
  assert.match(fn![0], /sets\[selected\]\?\.colorways/);
});

test('确认按钮把选中的配色 id 一起送出', () => {
  assert.match(src, /runApplyDesign\(sets\[selected\], sets\[selected\]\?\.pageBackground, selectedColorway\)/);
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `cd apps/web && pnpm test 2>&1 | grep -A3 "cv-swatches"`
Expected: FAIL

- [ ] **Step 3: 加选色行**

在 `offerDesignCard` 里，`let selected = 0;` 之后加：

```typescript
      // 第三套(深色椭圆)带 colorways:选中它时在列表下方展开一排色点,选完一起确认。
      let selectedColorway: string | undefined = undefined;
      const swatchRow = document.createElement('div');
      swatchRow.className = 'cv-swatches';
      swatchRow.style.display = 'none';
```

把 `repaint` 替换为：

```typescript
      const repaint = () => {
        picks.forEach((p, i) => p.setAttribute('aria-checked', i === selected ? 'true' : 'false'));
        const ways = sets[selected]?.colorways;
        if (!ways || ways.length === 0) {
          swatchRow.style.display = 'none';
          swatchRow.replaceChildren();
          selectedColorway = undefined;
          return;
        }
        if (!ways.some((w) => w.id === selectedColorway)) selectedColorway = ways[0]!.id;
        swatchRow.replaceChildren();
        for (const way of ways) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'cv-swatch';
          dot.style.background = way.bg;
          dot.title = currentLang === 'zh' ? way.name : way.nameEn;
          dot.setAttribute('aria-label', dot.title);
          dot.setAttribute('aria-pressed', way.id === selectedColorway ? 'true' : 'false');
          dot.addEventListener('click', () => { selectedColorway = way.id; repaint(); });
          swatchRow.appendChild(dot);
        }
        swatchRow.style.display = '';
      };
```

在 `inner.appendChild(list);` 之后加 `inner.appendChild(swatchRow);`，
并把确认按钮的回调改为：

```typescript
      go.addEventListener('click', () => {
        if (sending) return;
        void runApplyDesign(sets[selected], sets[selected]?.pageBackground, selectedColorway);
      });
```

- [ ] **Step 4: 加样式**

`editor-port.css` 在 `.cv-opt.is-recap` 规则之后加：

```css
.editor-port .cv-swatches{ display:flex; gap:8px; padding:8px 3px 2px; }
.editor-port .cv-swatch{
  width:26px; height:26px; border-radius:50%; border:1px solid var(--border);
  cursor:pointer; padding:0; transition:box-shadow .15s, transform .15s;
}
.editor-port .cv-swatch:hover{ transform:scale(1.08); }
.editor-port .cv-swatch[aria-pressed="true"]{ box-shadow:0 0 0 2px var(--grad-purple); }
```

- [ ] **Step 5: 跑测试并在真机看一眼**

Run: `cd apps/web && pnpm test 2>&1 | tail -20`
Expected: 全绿

再起本地 web（端口必须是 3000 或 3210，换端口浏览器登录会 403），走到设计环节，
选中第三套确认色点出现、选色后确认能出深色书。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/album/editor-v2/
git commit -m "feat(editor): 第三套选中后展开配色色点,与封面组一起确认"
```

---

### Task 13（阻塞）: 两个新封底版式

**阻塞原因：** 版式稿由小雨提供，未到位。

到位后按 Task 7 的同一套流程做（JSON + HTML 模板 + 两处 registry + `templates:generate`
+ 截图对照），然后把 Task 9 的 `SET_LAYOUT` 表里第 1/2/4 套的 `ending` 换成新 id。
封底模板**必须有文字槽** —— 纯图 ending 会让 compose 写的封尾文案全部落空（mag-20 就是
这个原因一直不进池）。

同时需要小雨给准确色值：现在 `#F0A4C2` / `#1F3A24` 等是照参考图目测取的。

---

## 附：验收

全部任务完成后，端到端验一次：

1. 起三个服务（web 3000 / agent 8001 / design-agent 8787），新建一本书走到设计环节。
2. 选第三套 + 深墨绿配色，确认成稿。
3. 查库：
   ```sql
   select page->>'templateId', page->'texts' from draft_pages
   where album_id = '<新书 id>' order by page_index limit 3;
   ```
   - 封面 `title` **不是** `My Memoir`
   - mag-23 那类多 title 槽模板不再重复同一句
   - 内页 html 里 `background-color` 按 `#0E2A47 → #12363A → #14140F` 循环
4. 刷新页面，对话里那张「已选的封面与封底」回执卡显示的是真文案，不是 `NORWAY / Record`。
