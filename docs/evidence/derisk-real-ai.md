# De-risk — real 火山 vision + 豆包文本 planning → layout_rules

Issue #32. T-Integration proved the seams in `AGENT_PIPELINE_MODE=mock`, but the
real AI output had **never** passed `layout_rules`. This is the record of running
the real pipeline against Volcano Ark, finding why the first real outputs failed,
fixing it, and confirming the 9 business rules + `AlbumLayoutPlan` schema pass.

- Branch: `chore/derisk-real-ai` (base `main` @ 99b5bfe)
- Date: 2026-05-28
- Mode: `AGENT_PIPELINE_MODE=real`, called the service functions directly
  (vision → writing → composing) plus one chat-edit; no云端, no uvicorn needed.
- Models (one Ark key, both stages on 火山):
  - vision = `doubao-seed-1-6-vision-250815`
  - planning (writing + composing + chat-edit) = `doubao-seed-2-0-lite-260428`
    (the `DEEPSEEK_*` slot points at `https://ark.cn-beijing.volces.com/api/v3`)
- Input: 3 real photos (1 portrait 432×768, 2 landscape) resized to ≤768px,
  base64 data-URI in memory only — never logged, never persisted as text.
- Key handling: `ARK_API_KEY` copied from the old `memoir-web/.env.local` into
  `apps/agent/.env` (gitignored — `git check-ignore` confirms). No key in any commit.

## 结论:**过**(after 3 fixes)

3 consecutive real runs all pass, with **`composing repair_attempts=0`** (real-AI
output satisfies every rule on the first attempt):

```
AlbumLayoutPlan schema: PASS
layout_rules (9):       PASS
composing repair_attempts=0
chat-edit:              OK (patch applied + re-validated)
```

The first real outputs did **not** pass. Three distinct failures, each fixed:

### Finding 1 — planning model rejects `response_format=json_object` (HTTP 400)

Writing/composing/chat-edit sent `response_format:{type:"json_object"}`
unconditionally. `doubao-seed-2-0-lite` rejects it:

```
400 InvalidParameter: `response_format.type` ... `json_object` is not supported
by this model
```

Vision was fine because it never sent the param. Without the param the model
returns clean JSON (`parse_json_loose` + the strict-JSON prompt + 1 repair already
cover parsing).

**Fix:** gate it behind `deepseek_use_json_object` (default **off**, since prod
uses doubao). Flip on only for a provider that supports it (real DeepSeek).

### Finding 2 — doubao reasoning models truncate JSON (intermittent `AGENT_VISION_FAILED`)

`doubao-seed-*` are reasoning models: `completion_tokens` = `reasoning_tokens` +
content, **sharing the `max_tokens` budget**. Vision spent 1,050–2,168 reasoning
tokens of a 4,096 cap; when reasoning ran long the JSON array got cut off →
`parse_json_loose` fails → `AGENT_VISION_FAILED`. Intermittent at 3 photos, would
get **worse as photo count grows** (up to 30) — a latent prod outage.

**Fix (asymmetric, by stage role):**
- **Vision** = pure structured extraction → disable thinking
  (`ark_disable_thinking=True`): `reasoning_tokens` 2,558 → **0**, content always
  fits. Faster + cheaper too. Raised vision `max_tokens` 4096 → 8192 (headroom for
  30 analyses).
- **Planning / chat-edit** = combinatorial constraint satisfaction → **keep
  thinking ON** (`deepseek_disable_thinking=False`). Verified empirically:
  disabling thinking on composing broke slot-fit (it put the `fill`-quality photo
  into a hero/detail cover slot). Raised `max_tokens` so reasoning+content fit:
  writing 512 → 2048, composing 4096 → 8192, chat-edit 2048 → 4096.

### Finding 3 — text overflows slot maxChars, repair doesn't fix it (rule 9)

doubao-lite consistently overshoots a slot's `maxChars` by a few chars and ignores
the repair feedback (title 24 → 22, still > 20). Rule 9 (`text length`) failed even
after the one repair, sinking the whole generation over a purely cosmetic limit.

**Fix:** deterministic `layout_rules.clamp_text` — trim each text slot to its
template's `maxChars` at the last word boundary. Applied in:
- composing (`clamp_page_texts` on the composed pages, before rule check), and
- chat-edit (`_clamp_patch` on the patch entries **before** apply, so the validated
  layout and the `layoutPatch` returned to Web are identical — previously the agent
  validated a clamped layout but returned the raw over-limit patch).

Only ever shortens text; `layout_rules` enforces no `minChars`, so it can never
introduce a new violation.

## 真实 layout 样本(脱敏 — no base64 / no PII)

Prompt: *"A winter escape to the snowy mountains with the person I love — quiet
mornings, cold bright light, and moments I never want to forget."*

vision output (3 photos): p1 `detail`/portrait (skier in snow), p2 `fill`/landscape
(the resized hotel shot read as a makeup palette on marble), p3 `hero`/portrait
(person making a snow angel). hero-cap (≤1 hero for 3 photos) respected.

```json
{
  "magazine": {
    "title": "Snow Light and Slow Mornings: Our Snowy Mountain Escape",
    "subtitle": "Quiet, glowing shared moments with my favorite person in the winter peaks I never want to forget",
    "style": "warm-film",
    "language": "en"
  },
  "pages": [
    { "pageIndex": 0, "templateId": "p01",
      "images": { "image": "p3" },
      "texts": { "title": "Snowy Mountain", "body": "Quiet glowing shared moments with my favorite person in the winter peaks I", "category": "Winter Travel Memoir" } },
    { "pageIndex": 1, "templateId": "mag-03",
      "images": { "image": "p1" },
      "texts": { "category": "Ski Day", "location": "Pine Snow Forest", "caption": "Resting in deep powdery snow after a long morning of" } },
    { "pageIndex": 2, "templateId": "mag-15",
      "images": { "imagePerson": "p1", "imageRoad": "p2" },
      "texts": { "title": "Slow Mornings", "date": "January 2024", "body": "Warm cozy indoor moments after a long day out in bright" } }
  ]
}
```

Why it's valid: cover first (`p01` is cover) with the `hero` photo p3; `fill` photo
p2 placed in `mag-15.imageRoad` (a landscape `detail|fill` slot, not a hero slot);
3 pages = `max(3, ceil(3/2.5))`; every photo used, p1 reused twice (≤2), no page
reuse; all orientation+quality slot constraints satisfied.

### chat-edit round-trip

userMessage: *"Make the cover title shorter and more poetic."* →

```json
{ "assistantReply": "I've updated your cover to feature the shorter, poetic title 'Snow Light Mornings' ...",
  "layoutPatch": [ { "pageIndex": 0, "texts": { "title": "Snow Light Mornings" } } ] }
```

Patch applied → re-validated against the 9 rules → PASS. Returned title is 19 chars
(≤ `p01.title` cap 20), matching the validated layout (post-fix; pre-fix it returned
a 24-char title).

## 火山豆包文本 planning 质量观感(够不够用)

**够用,带一个必须保留的护栏。**

- **slot-fit reasoning(thinking on)**: solid. Across runs it correctly reserves
  the cover for hero/detail, routes the `fill` photo to a fill-accepting slot, and
  varies templates (`p01` / `mag-03` / `mag-15`). Composing passes rules on the
  first attempt (`repair_attempts=0`) — no repair needed once thinking is on.
- **editorial voice (writing)**: reasonable, on-tone titles + style picks
  (`warm-film` for a warm/quiet winter set is a sensible choice).
- **weak spot — char counting**: it does **not** respect `maxChars`. It writes to
  ~the limit and overshoots, and won't self-correct on repair. The `clamp_text`
  fix is **load-bearing**, not a nicety.
- **cosmetic residual**: because the model writes long, the clamp trims some
  captions mid-thought (e.g. page-0 body ends "...the winter peaks I"). Rule-pass
  is solid; the abrupt endings are user-editable. A prompt nudge to "write concise
  captions well under the limit" could reduce truncation — optional polish, not a
  blocker.
- **cost/latency**: vision with thinking off ≈ 2.2k tokens/call (was ~3.1–3.8k);
  composing ≈ 1.8k in / 2.0k out. End-to-end ≈ 30–40s for 3 photos.

## Residual risks (not blocking ship)

1. **Scale (16 pages / 30 photos)**: only validated at 3 photos here. `max_tokens`
   raised with this in mind, but the >10-photo path is unverified end-to-end.
2. **Caption truncation** ends mid-sentence (cosmetic, editable). See above.
3. **`DEEPSEEK_*` → DeepSeek switch**: if the planning slot ever points at real
   DeepSeek, set `DEEPSEEK_USE_JSON_OBJECT=true` and `DEEPSEEK_DISABLE_THINKING=true`
   (DeepSeek supports json_object and is non-reasoning on `deepseek-chat`).

## Files changed (PR `chore/derisk-real-ai`)

- `apps/agent/src/settings.py` — `deepseek_use_json_object` (default false),
  `ark_disable_thinking` (default true), `deepseek_disable_thinking` (default false)
- `apps/agent/src/services/vision.py` — thinking-disabled extra_body, max_tokens 8192
- `apps/agent/src/services/planning.py` — gated response_format + thinking extra_body,
  max_tokens bumps, `clamp_page_texts` on composed pages
- `apps/agent/src/services/layout_rules.py` — `clamp_text` / `clamp_texts_for_template` /
  `clamp_page_texts`
- `apps/agent/src/services/chat_edit.py` — gated response_format + thinking extra_body,
  max_tokens bump, `_clamp_patch` so the returned patch == the validated layout

39 existing agent unit tests still pass (`pytest -q`).
