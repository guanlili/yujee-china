# PR249 Stage3 Edit-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issue #265: replace the authoring path with stateful `/v3/edit-chat`, agent-owned committed history, pending/ack edit ops, Web-side atomic album writes, and Stage3 case4 layout swap support.

**Architecture:** Keep the stack from #262/#263/#264. The Agent owns `agent.edit_sessions`, `agent.edit_messages`, and `agent.edit_ops`; Web owns `albums.draft_json` and `albums.stage`. Agent returns a commit bundle with `opId`; Web applies `pagesTexts`, `patches`, and `progressDecision` in one album transaction, then calls `/internal/agent-ack`.

**Tech Stack:** TypeScript/Zod contracts in `packages/contracts`, Pydantic/FastAPI in `apps/agent`, Node test runner for Web, pytest for Agent, existing `psycopg` Agent DB boundary, existing `gemini_layout` and `internal/agent-data` shared surfaces.

---

## Ground Rules

- Worktree: `/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/.worktrees/pr249-stage3-edit-chat`
- Branch: `codex/pr249-stage3-edit-chat`
- Base branch: `codex/pr249-stage2-select-layout`
- Do not merge to `main`.
- Do not reimplement shared #262/#264 facilities:
  - `apps/agent/migrations/versions/20260626_0001_agent_edit_boundary.py`
  - `POST /internal/agent-ack`
  - `GET /api/v3/internal/agent-data?type=page-info|chapter-search|page-photos`
  - `transientPagePhotoRefs`
  - `packages/contracts/template-previews`
  - Stage2 `engine/gemini_layout.py`
- Any implementation agent must write tests first, run the targeted tests, self-review, commit, and report exact commands.
- Keep old `chapter-chat` files only as compatibility unless removing them is necessary. The editor's active authoring path must call `edit-chat`.

## File Structure

Contracts:
- Modify `packages/contracts/src/v3.ts`
  - Add `V3EditChatFocus`
  - Add `V3EditProgressDecision`
  - Add `V3EditChatRequest`
  - Add `V3EditChatResponse`
  - Export associated TypeScript types
- Modify `packages/contracts/src/v3.test.ts`
  - Add schema tests for request/response strictness, required `opId`, and progress decision mapping shape.

Agent:
- Modify `apps/agent/src/schemas.py`
  - Mirror the new TS schemas exactly.
- Modify `apps/agent/src/db.py`
  - Add `list_committed_messages(...)`
  - Add `create_pending_turn(...)`
  - Reuse existing `acknowledge_op(...)`
- Create `apps/agent/src/agents/editing/__init__.py`
- Create `apps/agent/src/agents/editing/web_client.py`
  - Fetch Web internal agent-data using `settings.web_base_url` and shared bearer.
- Create `apps/agent/src/agents/editing/handler.py`
  - Implement `/v3/edit-chat` response generation, pending op write, committed-only history loading, and case4 layout swap helper.
- Modify `apps/agent/src/engine/gemini_layout.py`
  - Permit `mode="case4-swap"` with `allowAddPages=True`; keep existing `mode="select"` behavior.
- Modify `apps/agent/src/routes.py`
  - Add `POST /v3/edit-chat`.
- Modify tests:
  - `apps/agent/tests/test_schemas.py`
  - `apps/agent/tests/test_agent_db.py`
  - `apps/agent/tests/test_chat_edit_v3.py`
  - `apps/agent/tests/test_gemini_layout.py`
  - `apps/agent/tests/test_v3_route_surface.py`

Web:
- Modify `apps/web/src/lib/agent/agent-client.ts`
  - Add `editChatV3(...)`
  - Add `ackEditOp(...)`
- Add `apps/web/src/lib/agent/agent-client-v3-edit-chat.test.ts`
- Add `apps/web/src/app/api/v3/albums/[uuid]/edit-chat/route.ts`
- Modify `apps/web/src/services/album/album-service.ts`
  - Add `editChatTurn(...)`
  - Apply `pagesTexts`, `patches`, and `progressDecision` to `V3StoryDraft`
  - Register/clear transient `pagePhotoRefs` for case4 requests
  - Call `agentClient.ackEditOp({ opId })` only after the album transaction succeeds
  - Do not write `albumMessageRepo` in `editChatTurn`
  - Extend `applyLayoutPatchToDraftPages` to append a new page when `entry.pageIndex === next.length`
- Modify `apps/web/src/services/album/album-service.test.ts`
  - Add tests for edit-chat atomic write, ack-after-write, no Web chat history writes, progress decision mapping, and append page patches.
- Modify `apps/web/src/lib/album/authoring-client.ts`
  - Add `postEditChat(...)`
  - Stop using `postChapterChat` in the active editor path.
- Modify `apps/web/src/lib/album/authoring-client.test.ts`
  - Add browser route test for `/edit-chat`.
- Modify `apps/web/src/components/album/editor-v2/EditorPort.tsx`
  - Replace the active `postChapterChat` call with `postEditChat`
  - Use `res.patches` instead of `res.layoutPatch`
  - Keep local page mirroring for responsiveness.
- Modify `apps/web/src/components/album/editor-v2/chapter-chat-wiring.test.ts`
  - Rename expectations to edit-chat or add new source guards that assert the editor calls `postEditChat`.

## Task 1: Contracts And Route Surface

**Files:**
- Modify: `packages/contracts/src/v3.ts`
- Modify: `packages/contracts/src/v3.test.ts`
- Modify: `apps/agent/src/schemas.py`
- Modify: `apps/agent/tests/test_schemas.py`
- Modify: `apps/agent/tests/test_v3_route_surface.py`
- Modify: `apps/agent/src/routes.py`

- [ ] **Step 1: Write failing TS contract tests**

Add tests to `packages/contracts/src/v3.test.ts`:

```ts
test('V3EditChatResponse requires opId and supports commit bundle fields', () => {
  assert.equal(
    V3EditChatResponse.safeParse({
      kind: 'edit',
      assistantReply: 'Updated.',
      patches: [{ pageIndex: 2, texts: { body: 'New copy' } }],
      pagesTexts: [{ pageIndex: 1, texts: { title: 'Coast' } }],
      progressDecision: { pageDone: true, chapterDone: true, advanceTo: 'theme' },
      opId: 'op_1',
      usage: { durationMs: 1, models: {} },
    }).success,
    true,
  );

  assert.equal(
    V3EditChatResponse.safeParse({
      kind: 'edit',
      assistantReply: 'Updated.',
      patches: [],
      usage: { durationMs: 1, models: {} },
    }).success,
    false,
  );
});

test('V3EditChatRequest is slim and does not carry chapter pages or history', () => {
  assert.equal(
    V3EditChatRequest.safeParse({
      albumId: 'alb_1',
      language: 'en',
      userMessage: 'write this chapter',
      focus: { chapterId: 'c1', pageIndex: 3 },
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
    }).success,
    true,
  );

  assert.equal(
    V3EditChatRequest.safeParse({
      albumId: 'alb_1',
      language: 'en',
      userMessage: 'write this chapter',
      focus: { chapterId: 'c1' },
      progress: { currentChapterId: 'c1', doneChapterIds: [] },
      history: [],
      pages: [],
    }).success,
    false,
  );
});
```

- [ ] **Step 2: Run TS test and verify red**

Run:

```bash
pnpm --filter @yujee/contracts test -- src/v3.test.ts
```

Expected: FAIL because `V3EditChatRequest` and `V3EditChatResponse` are not exported.

- [ ] **Step 3: Add TS schemas**

Add after `V3StoryDraft` in `packages/contracts/src/v3.ts`:

```ts
export const V3EditChatFocus = z
  .object({
    chapterId: z.string().min(1).optional(),
    pageIndex: z.number().int().nonnegative().optional(),
  })
  .strict();
export type V3EditChatFocus = z.infer<typeof V3EditChatFocus>;

export const V3EditProgressDecision = z
  .object({
    pageDone: z.boolean().optional(),
    chapterDone: z.boolean().optional(),
    advanceTo: z.literal('theme').nullable().optional(),
  })
  .strict();
export type V3EditProgressDecision = z.infer<typeof V3EditProgressDecision>;

export const V3EditChatRequest = z
  .object({
    albumId: z.string().min(1),
    language: V3Language,
    userMessage: z.string().max(500),
    focus: V3EditChatFocus,
    progress: V3StoryProgress,
  })
  .strict();
export type V3EditChatRequest = z.infer<typeof V3EditChatRequest>;

export const V3EditChatResponse = z
  .object({
    kind: z.enum(['talk', 'write', 'edit']),
    assistantReply: z.string().min(1).max(500),
    patches: z.array(V3LayoutPatchEntry).default([]),
    pagesTexts: z.array(V3PageTextsPatch).optional(),
    progressDecision: V3EditProgressDecision.optional(),
    opId: z.string().min(1),
    usage: V3Usage,
  })
  .strict();
export type V3EditChatResponse = z.infer<typeof V3EditChatResponse>;
```

- [ ] **Step 4: Write failing Python schema and route tests**

Add to `apps/agent/tests/test_schemas.py`:

```python
def test_v3_edit_chat_requires_op_id_and_rejects_inline_pages() -> None:
    req = schemas.V3EditChatRequest(
        albumId="alb_1",
        language="en",
        userMessage="write it",
        focus={"chapterId": "c1", "pageIndex": 1},
        progress={"currentChapterId": "c1", "doneChapterIds": []},
    )
    assert req.focus.chapterId == "c1"

    with pytest.raises(ValidationError):
        schemas.V3EditChatRequest(
            albumId="alb_1",
            language="en",
            userMessage="write it",
            focus={"chapterId": "c1"},
            progress={"currentChapterId": "c1", "doneChapterIds": []},
            pages=[],
        )

    with pytest.raises(ValidationError):
        schemas.V3EditChatResponse(
            kind="edit",
            assistantReply="Updated.",
            patches=[],
            usage={"durationMs": 1, "models": {}},
        )
```

Add `/v3/edit-chat` to route surface expectations in `apps/agent/tests/test_v3_route_surface.py`.

- [ ] **Step 5: Run Python tests and verify red**

Run:

```bash
apps/agent/.venv/bin/pytest apps/agent/tests/test_schemas.py apps/agent/tests/test_v3_route_surface.py -q
```

Expected: FAIL because Python schemas and route are missing.

- [ ] **Step 6: Add Python schemas and route stub**

Mirror the TS schema in `apps/agent/src/schemas.py`:

```python
class V3EditChatFocus(_V3Strict):
    chapterId: str | None = Field(default=None, min_length=1)
    pageIndex: int | None = Field(default=None, ge=0)


class V3EditProgressDecision(_V3Strict):
    pageDone: bool | None = None
    chapterDone: bool | None = None
    advanceTo: Literal["theme"] | None = None


class V3EditChatRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    userMessage: str = Field(max_length=500)
    focus: V3EditChatFocus
    progress: V3StoryProgress


V3EditChatKind = Literal["talk", "write", "edit"]


class V3EditChatResponse(_V3Strict):
    kind: V3EditChatKind
    assistantReply: str = Field(min_length=1, max_length=500)
    patches: list[V3LayoutPatchEntry] = Field(default_factory=list)
    pagesTexts: list[V3PageTextsPatch] | None = None
    progressDecision: V3EditProgressDecision | None = None
    opId: str = Field(min_length=1)
    usage: V3Usage
```

Add imports and route in `apps/agent/src/routes.py`:

```python
from .agents.editing import handler as edit_chat_v3
from .agents.editing.handler import EditChatError

@router.post("/v3/edit-chat", dependencies=[Depends(require_bearer)])
async def submit_edit_chat(req: V3EditChatRequest) -> dict[str, Any]:
    with sync_endpoint_errors(
        log,
        "v3_edit_chat",
        EditChatError,
        known_status=status.HTTP_502_BAD_GATEWAY,
        known_code="AGENT_PLANNING_FAILED",
    ):
        response: V3EditChatResponse = await edit_chat_v3.run(req)
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}
```

Create `apps/agent/src/agents/editing/__init__.py` and `handler.py` with a temporary failing implementation that raises `EditChatError("not implemented")`. Task 2 replaces it.

- [ ] **Step 7: Run contract and route tests**

Run:

```bash
pnpm --filter @yujee/contracts test -- src/v3.test.ts
apps/agent/.venv/bin/pytest apps/agent/tests/test_schemas.py apps/agent/tests/test_v3_route_surface.py -q
```

Expected: contract/schema/route surface pass; route call may return the known planning error until Task 2.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/v3.ts packages/contracts/src/v3.test.ts apps/agent/src/schemas.py apps/agent/src/routes.py apps/agent/src/agents/editing apps/agent/tests/test_schemas.py apps/agent/tests/test_v3_route_surface.py
git commit -m "feat: add v3 edit-chat contracts"
```

## Task 2: Agent Stateful Edit Handler And DB Gating

**Files:**
- Modify: `apps/agent/src/db.py`
- Create/modify: `apps/agent/src/agents/editing/handler.py`
- Create: `apps/agent/src/agents/editing/web_client.py`
- Modify: `apps/agent/src/engine/gemini_layout.py`
- Modify: `apps/agent/tests/test_agent_db.py`
- Modify: `apps/agent/tests/test_chat_edit_v3.py`
- Modify: `apps/agent/tests/test_gemini_layout.py`
- Modify: `apps/agent/tests/test_v3_route_surface.py`

- [ ] **Step 1: Write failing Agent DB repository tests**

Add to `apps/agent/tests/test_agent_db.py` inside the `AGENT_TEST_DATABASE_URL` gated test area:

```python
def test_agent_edit_repo_committed_history_excludes_pending(monkeypatch) -> None:
    # Use AGENT_TEST_DATABASE_URL, migrate with alembic, insert one committed and one pending message.
    # Assert repo.list_committed_messages(album_id, chapter_id="c1", limit=20) returns only committed rows.
```

Implement the test with real inserts like existing `test_agent_edit_repo_ack_integration`. The expected returned list is:

```python
[{"role": "user", "content": "committed user"}]
```

Add:

```python
def test_agent_edit_repo_create_pending_turn_inserts_op_and_messages(monkeypatch) -> None:
    # Call create_pending_turn(album_id="alb", chapter_id="c1", user_content="u",
    # assistant_content="a", kind="edit_text", payload={"patches": []}, usage={"durationMs": 1}).
    # Assert edit_ops.status == "pending", both edit_messages rows are pending,
    # and acknowledge_op(op_id) turns them committed.
```

- [ ] **Step 2: Run DB tests and verify red**

Run:

```bash
apps/agent/.venv/bin/pytest apps/agent/tests/test_agent_db.py -q
```

Expected: FAIL because repository methods are missing. If `AGENT_TEST_DATABASE_URL` is unset, add static tests for method names and SQL fragments, then run the test file and confirm the static tests fail first.

- [ ] **Step 3: Implement repository methods**

In `apps/agent/src/db.py`, add:

```python
async def list_committed_messages(self, album_id: str, *, chapter_id: str | None, limit: int = 20) -> list[dict[str, str]]:
    ...

async def create_pending_turn(
    self,
    *,
    album_id: str,
    chapter_id: str | None,
    user_content: str,
    assistant_content: str,
    kind: str,
    payload: dict[str, Any],
    usage: dict[str, Any] | None = None,
) -> str:
    ...
```

Use `psycopg.connect(settings.database_url)` and one transaction. `create_pending_turn` must:

```sql
insert into agent.edit_sessions (album_id, version, session_json)
values (%s, 0, %s::jsonb)
on conflict (album_id)
do update set
  version = agent.edit_sessions.version + 1,
  session_json = excluded.session_json,
  updated_at = now()
returning id
```

Then insert:

```sql
insert into agent.edit_ops (op_id, album_id, session_id, kind, status, payload_json)
values (%s, %s, %s, %s, 'pending', %s::jsonb)
```

Then insert user and assistant messages with `status='pending'` and the same `op_id`.

`list_committed_messages` must query:

```sql
select role, content
  from agent.edit_messages
 where album_id = %s
   and status = 'committed'
   and (%s::text is null or chapter_id = %s)
 order by created_at desc
 limit %s
```

Return chronological order to the model.

- [ ] **Step 4: Write failing edit handler tests**

In `apps/agent/tests/test_chat_edit_v3.py`, add tests that use fake repository and fake Web client:

```python
def test_edit_chat_response_requires_op_id_for_write_turn():
    repo = FakeRepo(op_id="op_123")
    resp = asyncio.run(edit_handler.run(_edit_req("write this"), repo=repo, tools=FakeTools()))
    assert resp.opId == "op_123"
    assert repo.created[0]["status"] == "pending"
```

```python
def test_history_reads_only_committed_messages():
    repo = FakeRepo(committed=[{"role": "assistant", "content": "committed only"}])
    asyncio.run(edit_handler.run(_edit_req("continue"), repo=repo, tools=FakeTools()))
    assert repo.history_args == {"album_id": "alb_v3", "chapter_id": "c1", "limit": 20}
```

```python
def test_case4_fetches_page_photos_via_agent_data_and_calls_gemini(monkeypatch):
    tools = FakeTools(page_photos=[{"photoId": "p1", "ref200px": "data:image/jpeg;base64,AA==", "orientation": "landscape", "takenAt": None}])
    calls = []
    async def fake_gemini(chapters, *, mode, allowAddPages):
        calls.append((chapters, mode, allowAddPages))
        return gemini_layout.GeminiLayoutResult(pages=[{"chapterId": "c1", "templateId": "mag-03", "slots": {"image": "p1"}}])
    monkeypatch.setattr(edit_handler.gemini_layout, "gemini_layout", fake_gemini)
    resp = asyncio.run(edit_handler.run(_edit_req("change the layout"), repo=FakeRepo(), tools=tools))
    assert tools.page_photo_requests == [{"albumId": "alb_v3", "chapterId": "c1"}]
    assert calls[0][1:] == ("case4-swap", True)
    assert resp.patches[0].templateId == "mag-03"
```

- [ ] **Step 5: Run edit handler tests and verify red**

Run:

```bash
apps/agent/.venv/bin/pytest apps/agent/tests/test_chat_edit_v3.py -q
```

Expected: FAIL because `agents.editing.handler` behavior is missing.

- [ ] **Step 6: Implement edit handler**

Implement `apps/agent/src/agents/editing/handler.py` with these functions:

```python
class EditChatError(RuntimeError):
    pass

def _usage(duration_ms: int, *, models: dict[str, str | None] | None = None) -> V3Usage:
    return V3Usage(durationMs=duration_ms, models=models or {})

def _kind_from_bundle(pages_texts: list[V3PageTextsPatch] | None, patches: list[V3LayoutPatchEntry]) -> str:
    if pages_texts:
        return "write"
    if patches:
        return "edit"
    return "talk"

def _op_kind(req: V3EditChatRequest, pages_texts: list[V3PageTextsPatch] | None, patches: list[V3LayoutPatchEntry], progress: V3EditProgressDecision | None) -> str:
    text = req.userMessage.lower()
    if "layout" in text or "版式" in text:
        return "swap_layout"
    if "photo" in text or "image" in text or "换图" in text:
        return "swap_image"
    if pages_texts:
        return "write_chapter"
    if patches:
        return "edit_text"
    if progress and progress.chapterDone:
        return "advance"
    return "edit_text"
```

`run(...)` must:

1. Load committed history from `repo.list_committed_messages(req.albumId, chapter_id=req.focus.chapterId, limit=20)`.
2. For a layout-swap request, call `tools.get_page_photos(albumId=req.albumId, chapterId=req.focus.chapterId)`.
3. For case4, call `gemini_layout.gemini_layout(chapters, mode="case4-swap", allowAddPages=True)` and legalize with `gemini_layout.legalize_layout(...)`.
4. Build `patches` from legal pages:

```python
V3LayoutPatchEntry(pageIndex=base_page_index + i, templateId=page["templateId"], images=page["images"], texts=page.get("texts") or {})
```

5. For text/write fallback, return talk unless a deterministic test fixture supplied bundle content. Do not invent large copy without model output.
6. Call `repo.create_pending_turn(...)` before returning.
7. Return `V3EditChatResponse(kind=..., assistantReply=..., patches=..., pagesTexts=..., progressDecision=..., opId=op_id, usage=...)`.

- [ ] **Step 7: Implement Web internal data client**

Create `apps/agent/src/agents/editing/web_client.py`:

```python
class WebAgentDataClient:
    async def get_page_photos(self, *, albumId: str, chapterId: str) -> list[dict[str, Any]]:
        settings = get_settings()
        url = f"{settings.web_base_url.rstrip('/')}/api/v3/internal/agent-data"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                params={"type": "page-photos", "albumId": albumId, "chapterId": chapterId},
                headers={"Authorization": f"Bearer {settings.agent_shared_secret}"},
            )
            resp.raise_for_status()
            body = resp.json()
        if body.get("type") != "page-photos":
            raise EditChatError("agent-data page-photos returned wrong type")
        return list(body.get("data", {}).get("photos", []))
```

Reuse this client in handler default arguments.

- [ ] **Step 8: Extend gemini_layout mode guard**

Add a test in `apps/agent/tests/test_gemini_layout.py`:

```python
def test_gemini_layout_accepts_case4_swap_mode_without_rejecting(monkeypatch):
    monkeypatch.setattr(gemini_layout.get_settings(), "select_layout_api_key", None, raising=False)
    with pytest.raises(gemini_layout.GeminiLayoutUnavailable):
        asyncio.run(gemini_layout.gemini_layout([_chapter()], mode="case4-swap", allowAddPages=True))
```

Then modify `apps/agent/src/engine/gemini_layout.py` guard:

```python
if mode not in {"select", "case4-swap"} or not allowAddPages:
    raise ValueError("gemini_layout expects mode='select' or 'case4-swap' and allowAddPages=True")
```

Keep candidate building and legalizer unchanged.

- [ ] **Step 9: Run Agent tests**

Run:

```bash
apps/agent/.venv/bin/pytest apps/agent/tests/test_agent_db.py apps/agent/tests/test_chat_edit_v3.py apps/agent/tests/test_gemini_layout.py apps/agent/tests/test_schemas.py apps/agent/tests/test_v3_route_surface.py -q
```

Expected: PASS, with DB integration skipped if `AGENT_TEST_DATABASE_URL` is not set.

- [ ] **Step 10: Commit**

```bash
git add apps/agent/src/db.py apps/agent/src/agents/editing apps/agent/src/engine/gemini_layout.py apps/agent/tests/test_agent_db.py apps/agent/tests/test_chat_edit_v3.py apps/agent/tests/test_gemini_layout.py apps/agent/tests/test_schemas.py apps/agent/tests/test_v3_route_surface.py
git commit -m "feat: add stateful v3 edit-chat agent"
```

## Task 3: Web Edit-Chat Service, Ack, And Atomic Album Writes

**Files:**
- Modify: `apps/web/src/lib/agent/agent-client.ts`
- Create: `apps/web/src/lib/agent/agent-client-v3-edit-chat.test.ts`
- Add: `apps/web/src/app/api/v3/albums/[uuid]/edit-chat/route.ts`
- Modify: `apps/web/src/services/album/album-service.ts`
- Modify: `apps/web/src/services/album/album-service.test.ts`

- [ ] **Step 1: Write failing agent client tests**

Create `apps/web/src/lib/agent/agent-client-v3-edit-chat.test.ts`:

```ts
test('editChatV3 posts slim request and validates opId response', async (t) => {
  const captured = mockFetch(t, {
    ok: true,
    data: {
      kind: 'edit',
      assistantReply: 'Updated.',
      patches: [{ pageIndex: 1, texts: { body: 'New' } }],
      opId: 'op_1',
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await agentClient.editChatV3({
    albumId: 'alb_1',
    language: 'en',
    userMessage: 'update',
    focus: { chapterId: 'c1', pageIndex: 1 },
    progress: { currentChapterId: 'c1', doneChapterIds: [] },
  });
  assert.equal(captured.url, 'http://agent.test/v3/edit-chat');
  assert.equal(res.opId, 'op_1');
});

test('ackEditOp posts /internal/agent-ack and returns ok boolean', async (t) => {
  const captured = mockFetch(t, { ok: true, data: { ok: true } });
  const ok = await agentClient.ackEditOp({ opId: 'op_1' });
  assert.equal(captured.url, 'http://agent.test/internal/agent-ack');
  assert.equal(ok, true);
});
```

- [ ] **Step 2: Run agent client test and verify red**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test src/lib/agent/agent-client-v3-edit-chat.test.ts
```

Expected: FAIL because client methods are missing.

- [ ] **Step 3: Implement Web agent client**

In `apps/web/src/lib/agent/agent-client.ts` import:

```ts
V3EditChatResponse,
V3InternalAgentAckResponse,
type V3EditChatRequest,
type V3InternalAgentAckRequest,
```

Add methods:

```ts
async editChatV3(payload: V3EditChatRequest): Promise<V3EditChatResponse> {
  return postSyncV3('/v3/edit-chat', payload, V3EditChatResponse, { albumId: payload.albumId });
},

async ackEditOp(payload: V3InternalAgentAckRequest): Promise<boolean> {
  const data = await postSyncV3('/internal/agent-ack', payload, V3InternalAgentAckResponse, { opId: payload.opId });
  return data.ok;
},
```

- [ ] **Step 4: Write failing album service tests**

Add to `apps/web/src/services/album/album-service.test.ts`:

```ts
test('editChatTurn applies pagesTexts patches and acks after album transaction', async (t) => {
  const user = await makeUser('edit-chat-atomic');
  const albumId = await seedStoryAlbum(user.id, 2);
  const calls: string[] = [];
  t.mock.method(agentClient, 'editChatV3', async () => ({
    kind: 'edit' as const,
    assistantReply: 'Updated.',
    pagesTexts: [{ pageIndex: 0, texts: { headline: 'Coast Days' } }],
    patches: [{ pageIndex: 1, texts: { body: 'Sea air' } }],
    progressDecision: { chapterDone: true },
    opId: 'op_1',
    usage: chatUsage,
  }));
  t.mock.method(agentClient, 'ackEditOp', async ({ opId }: { opId: string }) => {
    calls.push(opId);
    return true;
  });
  const res = await albumService.editChatTurn(user.id, albumId, {
    language: 'en',
    chapterId: 'c1',
    userMessage: 'write and finish',
    focusedPageIndex: 1,
  });
  assert.equal(res.opId, 'op_1');
  assert.deepEqual(calls, ['op_1']);
  const draft = (await albumRepo.findById(albumId))!.draftJson as V3StoryDraft;
  assert.equal(draft.pages?.[0]?.texts.headline, 'Coast Days');
  assert.equal(draft.pages?.[1]?.texts.body, 'Sea air');
  assert.deepEqual(draft.progress.doneChapterIds, ['c1']);
  assert.equal(draft.progress.currentChapterId, 'c2');
});
```

Add:

```ts
test('editChatTurn never writes Web album_messages history', async (t) => {
  const user = await makeUser('edit-chat-no-web-history');
  const albumId = await seedStoryAlbum(user.id, 1);
  t.mock.method(agentClient, 'editChatV3', async () => ({
    kind: 'talk' as const,
    assistantReply: 'Tell me more.',
    patches: [],
    opId: 'op_talk',
    usage: chatUsage,
  }));
  t.mock.method(agentClient, 'ackEditOp', async () => true);
  await albumService.editChatTurn(user.id, albumId, {
    language: 'en',
    chapterId: 'c1',
    userMessage: 'hello',
  });
  const rows = await albumMessageRepo.findRecentByAlbumChapter(albumId, 'c1', 20);
  assert.deepEqual(rows, []);
});
```

Add:

```ts
test('editChatTurn maps advanceTo theme to album stage only after chapter progress write', async (t) => {
  const user = await makeUser('edit-chat-theme');
  const albumId = await seedStoryAlbum(user.id, 1);
  t.mock.method(agentClient, 'editChatV3', async () => ({
    kind: 'talk' as const,
    assistantReply: 'Ready for theme.',
    patches: [],
    progressDecision: { chapterDone: true, advanceTo: 'theme' as const },
    opId: 'op_theme',
    usage: chatUsage,
  }));
  t.mock.method(agentClient, 'ackEditOp', async () => true);
  await albumService.editChatTurn(user.id, albumId, {
    language: 'en',
    chapterId: 'c1',
    userMessage: 'done',
  });
  const album = await albumRepo.findById(albumId);
  assert.equal(album?.stage, 'theme');
});
```

Add append patch test:

```ts
test('editChatTurn supports case4 append page patch at next pageIndex', async (t) => {
  const user = await makeUser('edit-chat-append');
  const albumId = await seedStoryAlbum(user.id, 1);
  t.mock.method(agentClient, 'editChatV3', async () => ({
    kind: 'edit' as const,
    assistantReply: 'Added a page.',
    patches: [{ pageIndex: 2, templateId: 'mag-03', images: { image: 'p1' }, texts: { title: 'More' } }],
    opId: 'op_append',
    usage: chatUsage,
  }));
  t.mock.method(agentClient, 'ackEditOp', async () => true);
  await albumService.editChatTurn(user.id, albumId, {
    language: 'en',
    chapterId: 'c1',
    userMessage: 'change layout and add page',
  });
  const draft = (await albumRepo.findById(albumId))!.draftJson as V3StoryDraft;
  assert.equal(draft.pages?.some((page) => page.pageIndex === 2 && page.templateId === 'mag-03'), true);
});
```

- [ ] **Step 5: Run album service tests and verify red**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test src/services/album/album-service.test.ts
```

Expected: FAIL because `editChatTurn` and append handling are missing.

- [ ] **Step 6: Implement `editChatTurn`**

In `album-service.ts`, add helper:

```ts
function applyPagesTextsToDraftPages(pages: V3Page[], patches: V3PageTextsPatch[]): V3Page[] {
  return pages.map((page) => {
    const patch = patches.find((item) => item.pageIndex === page.pageIndex);
    return patch ? { ...page, texts: { ...page.texts, ...patch.texts } } : page;
  });
}
```

Extend `applyLayoutPatchToDraftPages`:

```ts
if (!page && entry.pageIndex === next.length && entry.templateId && entry.images && entry.texts) {
  next.push({
    pageIndex: entry.pageIndex,
    templateId: entry.templateId,
    images: { ...entry.images },
    texts: { ...entry.texts },
    ...(entry.imagePos !== undefined ? { imagePos: { ...entry.imagePos } } : {}),
  });
  continue;
}
```

Add `editChatTurn`:

```ts
async editChatTurn(userId: string, albumId: string, input: {
  language: V3Language;
  chapterId?: string;
  userMessage: string;
  focusedPageIndex?: number;
  pagePhotoRefs?: Record<string, string> | Array<{ photoId: string; ref200px: string }>;
}): Promise<V3EditChatResponse> {
  const album = await this.findOwned(userId, albumId);
  const normalized = readStoryDraft(album.draftJson);
  if (!normalized) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft');
  if (input.chapterId && !normalized.tree.chapters.some((chapter) => chapter.chapterId === input.chapterId)) {
    throw ERRORS.VALIDATION_FAILED('chapterId not found in draft');
  }
  if (input.chapterId && input.pagePhotoRefs) {
    transientPagePhotoRefs.register({ albumId, chapterId: input.chapterId, refs: input.pagePhotoRefs });
  }
  try {
    const result = await agentClient.editChatV3({
      albumId,
      language: input.language,
      userMessage: input.userMessage,
      focus: {
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(input.focusedPageIndex !== undefined ? { pageIndex: input.focusedPageIndex } : {}),
      },
      progress: normalized.progress,
    });

    await db.transaction(async (tx) => {
      const latest = await albumRepo.findById(albumId);
      if (!latest) throw ERRORS.ALBUM_NOT_FOUND();
      const current = readStoryDraft(latest.draftJson);
      if (!current?.pages) throw ERRORS.VALIDATION_FAILED('album has no V3 story draft pages');

      let pages = current.pages;
      if (result.pagesTexts?.length) pages = applyPagesTextsToDraftPages(pages, result.pagesTexts);
      if (result.patches.length > 0) pages = applyLayoutPatchToDraftPages(pages, result.patches);

      const chapterOrder = current.tree.chapters.map((chapter) => chapter.chapterId);
      const doneSet = new Set(current.progress.doneChapterIds);
      if (result.progressDecision?.chapterDone && input.chapterId) doneSet.add(input.chapterId);
      const doneChapterIds = chapterOrder.filter((id) => doneSet.has(id));
      const currentChapterId = chapterOrder.find((id) => !doneSet.has(id)) ?? null;
      const nextDraft: V3StoryDraft = {
        version: 'v3-story',
        tree: current.tree,
        pages,
        progress: { currentChapterId, doneChapterIds },
      };
      await albumRepo.update(tx, albumId, {
        draftJson: nextDraft,
        ...(result.progressDecision?.advanceTo === 'theme' ? { stage: 'theme' as const } : {}),
      });
    });

    await agentClient.ackEditOp({ opId: result.opId });
    return result;
  } finally {
    if (input.chapterId && input.pagePhotoRefs) transientPagePhotoRefs.clear(albumId, input.chapterId);
  }
}
```

Do not call `albumMessageRepo` in this method.

- [ ] **Step 7: Add browser route**

Create `apps/web/src/app/api/v3/albums/[uuid]/edit-chat/route.ts` with body schema:

```ts
const BodySchema = V3EditChatRequest.pick({
  language: true,
  userMessage: true,
})
  .extend({
    chapterId: z.string().min(1).optional(),
    focusedPageIndex: z.number().int().nonnegative().optional(),
    pagePhotoRefs: z.record(z.string(), V3AnalyzeImageDataUrl).optional(),
  })
  .strict();
```

Route handler:

```ts
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.editChatTurn(user.id, uuid, {
      language: body.language,
      ...(body.chapterId ? { chapterId: body.chapterId } : {}),
      userMessage: body.userMessage,
      ...(body.focusedPageIndex !== undefined ? { focusedPageIndex: body.focusedPageIndex } : {}),
      ...(body.pagePhotoRefs ? { pagePhotoRefs: body.pagePhotoRefs } : {}),
    });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
```

- [ ] **Step 8: Run Web tests**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test src/lib/agent/agent-client-v3-edit-chat.test.ts src/services/album/album-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/agent/agent-client.ts apps/web/src/lib/agent/agent-client-v3-edit-chat.test.ts apps/web/src/app/api/v3/albums/'[uuid]'/edit-chat/route.ts apps/web/src/services/album/album-service.ts apps/web/src/services/album/album-service.test.ts
git commit -m "feat: apply v3 edit-chat turns in web"
```

## Task 4: Browser Client And Editor Wiring

**Files:**
- Modify: `apps/web/src/lib/album/authoring-client.ts`
- Modify: `apps/web/src/lib/album/authoring-client.test.ts`
- Modify: `apps/web/src/components/album/editor-v2/EditorPort.tsx`
- Modify: `apps/web/src/components/album/editor-v2/chapter-chat-wiring.test.ts`
- Modify: `apps/web/src/components/album/editor-v2/chapter-guide-satisfaction.test.ts`

- [ ] **Step 1: Write failing authoring client test**

Add to `apps/web/src/lib/album/authoring-client.test.ts`:

```ts
test('postEditChat POSTs slim edit-chat body to /api/v3/albums/:id/edit-chat', async (t) => {
  const captured = mockFetch(t, {
    ok: true,
    data: {
      kind: 'talk',
      assistantReply: 'Tell me more.',
      patches: [],
      opId: 'op_1',
      usage: { durationMs: 1, models: {} },
    },
  });
  const res = await postEditChat('alb_1', {
    language: 'en',
    chapterId: 'c2',
    userMessage: 'about it',
    focusedPageIndex: 3,
  });
  assert.equal(captured.url, '/api/v3/albums/alb_1/edit-chat');
  assert.deepEqual(captured.body, {
    language: 'en',
    chapterId: 'c2',
    userMessage: 'about it',
    focusedPageIndex: 3,
  });
  assert.equal(res.opId, 'op_1');
});
```

- [ ] **Step 2: Run authoring test and verify red**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test src/lib/album/authoring-client.test.ts
```

Expected: FAIL because `postEditChat` is missing.

- [ ] **Step 3: Implement `postEditChat`**

In `apps/web/src/lib/album/authoring-client.ts`:

```ts
export interface EditChatInput {
  language: 'zh' | 'en';
  chapterId?: string;
  userMessage: string;
  focusedPageIndex?: number;
  pagePhotoRefs?: Record<string, string>;
}

export function postEditChat(albumId: string, input: EditChatInput): Promise<V3EditChatResponse> {
  return postJson(`/api/v3/albums/${albumId}/edit-chat`, input);
}
```

- [ ] **Step 4: Write failing Editor source guards**

Update `chapter-chat-wiring.test.ts` or create `edit-chat-wiring.test.ts`:

```ts
test('authoring send routes to edit-chat turn', () => {
  assert.match(src, /postEditChat\(albumId, \{/);
  assert.doesNotMatch(src, /postChapterChat\(albumId, \{/);
});

test('edit-chat applies pagesTexts and patches from commit bundle', () => {
  const fn = /async function runEditChatTurn\([\s\S]*?\n {4}\}/.exec(src);
  assert.ok(fn, 'runEditChatTurn must exist');
  const body = fn![0];
  assert.match(body, /res\.pagesTexts/);
  assert.match(body, /res\.patches/);
  assert.doesNotMatch(body, /res\.layoutPatch/);
});
```

- [ ] **Step 5: Run Editor source tests and verify red**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/chapter-chat-wiring.test.ts src/components/album/editor-v2/chapter-guide-satisfaction.test.ts
```

Expected: FAIL because the editor still imports/calls `postChapterChat`.

- [ ] **Step 6: Wire EditorPort to edit-chat**

In `EditorPort.tsx`:

- Replace import `postChapterChat` with `postEditChat`.
- Rename `runChapterChatTurn` to `runEditChatTurn` or keep a wrapper name only if source tests are updated consistently.
- Replace call:

```ts
const res = await postEditChat(albumId, {
  language: currentLang === 'zh' ? 'zh' : 'en',
  chapterId,
  userMessage,
  ...(selectedPageIndex != null ? { focusedPageIndex: selectedPageIndex } : {}),
});
```

- Replace edit patch application:

```ts
if (res.pagesTexts) wroteChapter = applyChapterWrite(res.pagesTexts);
if (res.patches.length > 0) applyChapterEdit(mapLayoutPatch(res.patches));
```

- Remove `kind === 'write'`/`kind === 'edit'` as the only patch gates. The new bundle can carry both `pagesTexts` and `patches` in one turn.
- If name chips still depend on `nameOptions`, remove that dependency or keep a separate local UI only if the new contract includes no `nameOptions`.

- [ ] **Step 7: Run browser-client tests**

Run:

```bash
pnpm --filter @yujee/web exec tsx --test src/lib/album/authoring-client.test.ts src/components/album/editor-v2/chapter-chat-wiring.test.ts src/components/album/editor-v2/chapter-guide-satisfaction.test.ts
```

Expected: PASS after source guards match new edit-chat path.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/album/authoring-client.ts apps/web/src/lib/album/authoring-client.test.ts apps/web/src/components/album/editor-v2/EditorPort.tsx apps/web/src/components/album/editor-v2/chapter-chat-wiring.test.ts apps/web/src/components/album/editor-v2/chapter-guide-satisfaction.test.ts
git commit -m "feat: route editor authoring through edit-chat"
```

## Task 5: Final Verification And PR Handoff

**Files:**
- No production edits unless verification finds a defect.

- [ ] **Step 1: Run full targeted Agent tests**

Run:

```bash
apps/agent/.venv/bin/pytest apps/agent/tests/test_agent_db.py apps/agent/tests/test_chat_edit_v3.py apps/agent/tests/test_chapter_chat_v3.py apps/agent/tests/test_gemini_layout.py apps/agent/tests/test_schemas.py apps/agent/tests/test_v3_route_surface.py -q
```

Expected: PASS, with DB integration skipped if `AGENT_TEST_DATABASE_URL` is not set.

- [ ] **Step 2: Run full targeted Web tests**

Run:

```bash
pnpm --filter @yujee/contracts test
pnpm --filter @yujee/web exec tsx --test src/lib/agent/agent-client-v3-edit-chat.test.ts src/lib/agent/agent-client-v3-chapter-chat.test.ts src/lib/album/authoring-client.test.ts src/services/album/album-service.test.ts src/app/api/v3/internal/agent-data/route.test.ts src/components/album/editor-v2/chapter-chat-wiring.test.ts src/components/album/editor-v2/chapter-guide-satisfaction.test.ts
pnpm --filter @yujee/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors and only intentional committed changes on `codex/pr249-stage3-edit-chat`.

- [ ] **Step 4: Open draft PR**

Base the PR on `codex/pr249-stage2-select-layout`, not `main`:

```bash
git push -u origin codex/pr249-stage3-edit-chat
gh pr create --draft --base codex/pr249-stage2-select-layout --head codex/pr249-stage3-edit-chat --title "[PR249/Stage3] Stateful edit-chat + agent ack" --body "Implements #265 on top of #264. Controller gate pending independent test and code-quality review."
```

- [ ] **Step 5: Independent gates**

Dispatch independent agents:

- Test agent: rerun the commands from Steps 1-3 and inspect behavior against issue #265.
- Code quality review agent: review diff from `codex/pr249-stage2-select-layout...codex/pr249-stage3-edit-chat`, focusing on duplicate shared logic, `albumMessageRepo` writes in edit-chat, ack ordering, and case4 `page-photos`.

- [ ] **Step 6: Controller PR comment**

Only after controller verification and both agents pass, comment on the PR:

```text
Controller gate: PASS for #265 on top of #264.

Evidence:
- Agent targeted tests: ...
- Web targeted tests: ...
- Contracts: ...
- Web typecheck: ...
- diff hygiene: ...

Notes:
- edit-chat history is Agent-owned; Web album_messages is not used by edit-chat.
- Web applies commit bundle before acking opId.
- PR is draft and not merged; ready for external test/acceptance agents.
```

## Self-Review

- Spec coverage:
  - `/v3/edit-chat` request/response contracts: Task 1.
  - `opId` required and pending/committed DB gating: Task 2.
  - T-history reads committed Agent messages only: Task 2.
  - Web atomic `pagesTexts + patches + progressDecision`: Task 3.
  - Web ack after album write: Task 3.
  - No Web `album_messages` writes in edit-chat path: Task 3.
  - `progressDecision` mapping to `V3StoryProgress` and `albums.stage`: Task 3.
  - case4 `page-photos` and `gemini_layout(mode="case4-swap")`: Task 2 and Task 3.
  - Editor active path switched from chapter-chat to edit-chat: Task 4.
- Placeholder scan: no open planning gaps are present.
- Type consistency:
  - TS and Python use `focus`, `progressDecision`, `patches`, `pagesTexts`, `opId`.
  - DB code uses migration field names `kind` and `payload_json`.
  - Web route body uses browser names `chapterId`, `focusedPageIndex`, and maps to Agent `focus`.
