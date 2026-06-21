# Agent V3 内部 Pipeline 设计

> **前置阅读**: `CLAUDE.md` -> `docs/architecture.md` -> [`docs/agent/contract.md`](./contract.md)
>
> 谁读这份: 写 `apps/agent/src/routes/*`、`apps/agent/src/services/*`、skills、schema mirror、logging 的人。
>
> 本文只讲 Agent 内部如何实现 V3:阶段边界、模型调用、确定性引擎、校验、降级、日志红线。Web <-> Agent 协议看 `contract.md`。

---

## 1. Pipeline Summary

V3 是五环节状态机,但 Agent 自身无状态。Web 持 `draft_json` authoring tree、`albums.stage`、`agent_jobs` 与积分生命周期;Agent 每次收到足够上下文,返回 tree/pages/patch/layout。

| Ring | Agent responsibility | Mode |
|---|---|---|
| ① 分析 | describe (cluster-aware, may concurrent) -> merge -> group beat -> template -> preview | async callback |
| ② 章节故事 | one turn dispatch: talk / write / edit | sync |
| ③ 主题与章节色 | recommend candidates, then deterministic apply | sync |
| ④ 书籍设计 | deterministic cover/ending patch or skip | sync |
| ⑤ 待导出 | bake tree values into render layout | sync |

Ownership:

- Agent never writes DB and never advances `albums.stage`.
- Agent never keeps session memory between calls.
- Agent never returns raw model output; every public response passes strict schema.
- Browser never calls Agent directly; Web server owns all Agent calls.

---

## 2. Analyze Internals

`POST /v3/analyze` accepts the only base64 payload in the system and runs in a FastAPI background task.

### 2.1 Describe

The describe stage loads `apps/agent/src/skills/describe_content.md` and calls the recognition model.

Primary/failover:

- Primary: GPT-5.5 Mini through the OpenAI-compatible slot.
- Per-call primary budget: 30s with one retry inside the AI client.
- Batch deadline: 90s; after that the describe batch falls back to the Ark slot.
- Failover: Volcano Ark doubao-vision.

Model writes only:

1. chapter membership;
2. `chapter.description`;
3. each photo's `sceneDescription`.

Code fills or overwrites:

- `photoId`;
- `width`;
- `height`;
- `orientation`;
- `takenAt`;
- `accentColor: null`;
- `artFont: null`.

Stage0 reads `takenAt` only. It does not read GPS and does not produce a place dimension. Grouping is part of the recognition-model output and can use time, the opaque `clusterId` label, and visual coherence — never coordinates.

### 2.1.1 Cluster-aware concurrent describe (#232 — framework; details in WP-C)

The browser may stamp each analyze photo with an opaque `clusterId` (`c1`/`c2`/…) derived locally from EXIF time/GPS (a same-place/same-time label, never a coordinate — see `architecture.md §3`). When clusters are present, describe is cluster-aware and may run concurrently:

- **Cluster = chapter floor**: photos sharing a `clusterId` stay together (same-cluster-must-join), different clusters must split. Clusters are sequenced by time order.
- **Scheduling (count-driven, not semantic)**: total photo count decides how many concurrent describe calls run (e.g. ≤20 → single call with cluster boundaries written into the prompt; >20 → pack whole clusters into 2 concurrent calls via `asyncio.gather`, >40 → 3; a single oversized cluster gets its own call and may be sub-chaptered by the model). Count thresholds only set concurrency width; they never re-cut the semantic grouping.
- **Merge**: per-call local chapter trees are concatenated in global cluster order, chapters renumbered `ch_1..N`, photo order preserved; the union must cover every photo (the existing omitted-photo retry safety net still applies per call).
- **Backward compatible**: when `clusterId` is absent/null on all photos, describe degrades to the current single-batch "model groups freely" path with no behavior change.

> WP-A only wires the `clusterId` contract field and these doc/notes. The concurrent scheduler, prompt cluster-boundary injection, and merge/renumber implementation land in WP-C (#232).

### 2.2 Group beat

`group` is a progress stage for UI and retry visibility. There is no separate model call after describe; the chapter grouping was already authored in describe and normalized by code.

### 2.3 Failure

Any describe provider failure, parse failure, schema failure, or deadline miss that cannot be recovered becomes `AGENT_VISION_FAILED`. Unexpected background errors become `AGENT_INTERNAL_ERROR`; background timeout becomes `AGENT_TIMEOUT`.

---

## 3. 套版 & Preview

The template stage loads `apps/agent/src/skills/select_template.md`.

Rules:

- The model receives only deterministic legal candidates.
- A legal candidate must match the requested category and have enough image slots for the current group/page.
- The model chooses an id from that candidate set; it does not invent ids.
- If the model fails or returns an illegal choice, pure code picks a deterministic fallback from the same legal set.

Preview:

- `generic_copy.fill_generic_copy` fills generic decoration and preview copy.
- Preview pages are usable immediately but are not final prose.
- Chapter `accentColor` and `artFont` stay null until apply-theme writes real values.
- The completed callback returns one `V3LayoutTree` plus preview `Page[]`.

---

## 4. Chapter Chat

`POST /v3/chapter-chat` is one stateless turn. The service classifies the turn into `talk`, `write`, or `edit`.

| Kind | Model path | Output |
|---|---|---|
| `talk` | DeepSeek text path | `assistantReply` only |
| `write` | DeepSeek text path with writing skill and slot hints | `pagesTexts` for the chapter |
| `edit` | DeepSeek for text-only changes; recognition model only when image/layout intent is detected | `layoutPatch` when needed |

Inputs:

- current chapter slice;
- pages for that chapter;
- recent `history`;
- current `userMessage`;
- optional `focusedPageIndex`.

Privacy and logging:

- `history` and `userMessage` may be sent to the model for the current turn.
- They are not persisted by Agent.
- Logs must not contain raw turn text; `history.content` and `userMessage` are redact keys in §9.

Patch rules:

- Text writing returns `V3PageTextsPatch[]`.
- Layout changes return `V3LayoutPatchEntry[]`.
- Agent validates the response shape before returning.
- Web owns merging and chapter done state.

---

## 5. Recommend & Apply Theme

### 5.1 Recommend

`POST /v3/recommend` runs recommendation skills:

- `recommend-theme`;
- `recommend-chapter-colors`.

Input is text/metadata only: chapter descriptions, photo scene descriptions, optional analysis summary, optional user message. It carries no base64.

Output (#236: purely per-chapter — no album-level theme options):

- exactly one `{subject, accentColor, artFont}` recommendation per chapter, where
  `subject` is the chapter's one-line title (grounded in that chapter, no trailing
  punctuation; the recommender clamps a missing subject to a neutral fallback);
- assistant reply;
- usage.

The Web client rejects missing, duplicate, or extra chapter coverage as invalid Agent output.

### 5.2 Apply Theme

`POST /v3/apply-theme` is deterministic.

- It receives the per-chapter choices (`{subject, accentColor, artFont}`).
- It emits page patches for SVG/decor surfaces where applicable.
- #236: it ALSO writes each chapter's `subject` into that chapter's `title` role text
  slot (clamped to the slot `maxChars`) — the chapter title is persisted. This is a
  deterministic, user-confirmed write at the theme stage; it does not call any model and
  is unrelated to the §4.1 analyze invariant (what the LLM writes in the analyze stage).
- It does not call any model.
- Web persists `accentColor/artFont` into the authoring tree, folds the page patch
  (subject→title + accent→svg) into `draft_json.pages`, and advances the stage when
  applicable.
- Finalize bakes text carriers from the tree into the render `Page.texts` format.

---

## 6. Cover

`POST /v3/cover` is deterministic and optional.

- `coverTemplateId` may be omitted or null.
- `endingTemplateId` may be omitted or null.
- If both are skipped, return `layoutPatch: []`.
- A non-empty patch only touches cover/ending pages.
- There is no forced cover page rule.
- Invalid ids or wrong categories become `AGENT_OUTPUT_VALIDATION`.

Web decides whether to fold patches into `draft_json.pages` and whether to advance `cover -> ready` or skip from `theme -> ready`.

---

## 7. Finalize

`POST /v3/finalize` is the only endpoint that receives the full authoring tree.

Steps:

1. read `tree` and complete `pages`;
2. bake each chapter's `accentColor` and `artFont` into `pages[].texts`;
3. build `AlbumLayoutPlan`;
4. run the single V3 validator;
5. return `{ layout, usage }`.

Boundaries:

- No model call.
- No base64.
- No stage advance.
- No credit mutation.
- No tree-shaped field leaks into `AlbumLayoutPlan`.

---

## 8. Progress, Timeouts, Failover

Analyze progress stages:

| Stage | Meaning |
|---|---|
| `describe` | recognition model output parsed and normalized |
| `group` | grouping progress beat; no extra model call |
| `template` | legal candidate selection plus deterministic fallback |
| `preview` | generic preview pages ready |

Timeouts:

- Analyze background task: 600s.
- Sync Agent call from Web: 60s.
- OpenAI-compatible describe primary: 30s per call, with one retry.
- Describe batch deadline before Ark failover: 90s.
- Agent callback to Web should be short and retryable; failure to callback is logged.

Failure surfaces:

- Analyze terminal failures use callback `event="failed"`.
- Sync endpoint failures use HTTP error envelopes.
- A failed sync endpoint must not mutate Web stage; Web only mutates after a validated success.

---

## 9. Validation, Errors, Privacy Redact

### 9.1 Validation

- TS zod schemas are the single truth source.
- Python Pydantic schemas mirror them with `extra='forbid'`.
- Every route validates request body before service execution.
- Every service validates response body before returning.
- The V3 validator is the single layout validation path for finalize and output safety.
- Sync output validation failures return HTTP 422 + `AGENT_OUTPUT_VALIDATION`.
- Analyze output validation failures become callback `failed` with `AGENT_OUTPUT_VALIDATION`.

### 9.2 Error mapping

| Situation | Agent code |
|---|---|
| bad request body | `AGENT_INVALID_INPUT` |
| invalid bearer | `AGENT_UNAUTHORIZED` |
| describe model or parse failure | `AGENT_VISION_FAILED` |
| text/planning model failure | `AGENT_PLANNING_FAILED` |
| invalid Agent-produced patch/layout | `AGENT_OUTPUT_VALIDATION` |
| background task deadline exceeded | `AGENT_TIMEOUT` |
| unknown exception | `AGENT_INTERNAL_ERROR` |

Web maps `AGENT_OUTPUT_VALIDATION` to Web-side `AGENT_INVALID_OUTPUT` before exposing or persisting it.

### 9.3 Redact rules

Privacy boundary matches `docs/architecture.md §3`: base64 and original photos are memory-only; Stage0 reads only `takenAt`; grouping uses time, the opaque `clusterId` label (#232), and visual coherence; no GPS, coordinate, or place dimension enters the request or the tree. `clusterId` is an opaque same-place/same-time label, not a coordinate, so it is **not** a redact target — the redact list keeps `lat`/`lng`/… as a defensive red line against real coordinates.

The redact key set is:

```text
base64
promptHint
userMessage
history.content
raw_response
email
user_id
api_key
secret
authorization
bearer
lat
lng
latitude
longitude
gps
coordinates
place
exif
```

Additional notes:

- `takenAt` may be used as a scalar value.
- Do not log a raw EXIF block.
- Data URLs and bearer tokens must be scrubbed inside string values even when the key name is not suspicious.
- A coordinate-like key in any incoming dict is a defensive redline and should be redacted even if the contract would reject it.
