# PR249 Spec Reaudit Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the work plan from PR #249's eight design documents, audit #260 against that design source, and only then implement confirmed gaps with tests.

**Architecture:** PR #249 docs are the source of truth. #260 is the current candidate implementation and must be audited as evidence, not treated as the design source. Work is split by stage/shared boundary so agents can inspect independently and report precise gaps before any code changes.

**Tech Stack:** GitHub PRs/issues, TypeScript contracts (`packages/contracts`), Next.js Web (`apps/web`), Python Agent/FastAPI (`apps/agent`), Pydantic/Zod parity, Node test runner, pytest, pnpm.

---

## Source Documents

Use PR #249 head `c317e5e97190fc417864bf6e563ecb37f8d5c373` as the design source:

- `docs/superpowers/specs/2026-06-25-agent-system-blueprint.md`
- `docs/superpowers/specs/2026-06-26-chief-architect-review.md`
- `docs/superpowers/specs/2026-06-26-detail-shared.md`
- `docs/superpowers/specs/2026-06-26-detail-stage1.md`
- `docs/superpowers/specs/2026-06-26-detail-stage2.md`
- `docs/superpowers/specs/2026-06-26-stage3-edit-agent-design.md`
- `docs/superpowers/specs/2026-06-26-detail-stage4.md`
- `docs/superpowers/specs/2026-06-26-detail-stage5.md`

Read a document with:

```bash
git show c317e5e97190fc417864bf6e563ecb37f8d5c373:docs/superpowers/specs/<file>.md
```

Audit target:

```bash
git fetch origin main codex/stage5-final-review fix/chat-mirror-user-language
git switch codex/stage5-final-review
```

Current #260 head at task creation: `eb661604f4a238a4897cc4a5e19ce16934ffc84f`.

---

## Audit Output Format

Every agent must return this structure:

```markdown
## Scope
- Docs read:
- Code paths inspected:

## Evidence
- Implemented:
- Missing:
- Contradictory:

## Required Tasks
- [ ] Task title
  - Source doc section:
  - Code files:
  - Failing test to add first:
  - Implementation path:
  - Verification command:

## Risk
- Blocking:
- Can defer:
```

Agents may decide whether to use their own sub-agents, but they must keep write scopes disjoint and must not merge branches.

---

## Task 1: Shared Contracts And Architecture Grounding

**Owner:** shared/contracts auditor
**Source docs:** blueprint, chief review, detail-shared
**Files to inspect:**
- `packages/contracts/src/v3.ts`
- `packages/contracts/src/layout.ts`
- `packages/contracts/src/v3.test.ts`
- `apps/agent/src/schemas.py`
- `apps/agent/tests/test_schemas.py`
- `apps/agent/src/engine/finalize_color.py`
- `apps/agent/src/engine/accent_color.py`
- `apps/agent/src/engine/simple_id.py`
- `apps/web/src/app/api/v3/internal/*`
- `apps/agent/migrations/**`

- [ ] Verify `V3Chapter` and `V3ChapterOverview` include `extractedColor` in TS and Python.
- [ ] Verify `V3AnalyzeCompleted.pages` is optional during migration, not required.
- [ ] Verify `finalize_color`, `accent_of_group`, `accent_from_photo`, and simple-id helpers exist as shared single-owner APIs.
- [ ] Verify agent-owned DB decisions exist or are explicitly missing: `agent` schema, Alembic migrations, `edit_sessions`, `edit_messages`, `edit_ops`.
- [ ] Verify internal callbacks exist: Agent→Web `GET /internal/agent-data` and Web→Agent `POST /internal/agent-ack`.
- [ ] Run:

```bash
pnpm --filter @yujee/contracts test
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests/test_schemas.py -q
```

Expected: tests pass after any implementation work; during audit, report current failures or missing tests.

---

## Task 2: Stage1 Analyze Tree-Only Pipeline

**Owner:** Stage1 auditor
**Source docs:** detail-stage1 plus blueprint Stage1 sections
**Files to inspect:**
- `apps/agent/src/flows/analyze.py`
- `apps/agent/src/agents/image_understanding/handler.py`
- `apps/agent/src/agents/image_grouping/**`
- `apps/agent/src/agents/regroup_unplaced/**`
- `apps/agent/src/engine/accent_color.py`
- `apps/agent/tests/test_v3_analyze.py`
- `apps/agent/tests/test_vision_groups.py`
- `apps/web/src/app/api/v3/internal/job-progress/route.ts`
- `apps/web/src/services/job/job-service.ts`

- [ ] Verify pipeline order is `1a group_photos -> 1c describe_chapters -> 1b group_unplaced -> 1d accent_of_group`.
- [ ] Verify Stage1 no longer builds pages, chooses templates, wraps cover/ending, or runs generic copy.
- [ ] Verify callback stores `draft_json={version, tree, progress}` with no required `pages`.
- [ ] Verify grouping invariants: coverage, no duplicates, at least one chapter, cluster atomicity, unplaced cluster atomic assignment.
- [ ] Verify `extractedColor` is generated after final chapter membership and `accentColor/artFont` remain null.
- [ ] Required failing tests if missing:
  - `test_analyze_completed_pages_optional`
  - `test_stage1_tree_contains_extracted_color_not_pages`
  - `test_grouping_never_returns_zero_chapters`
  - `test_unplaced_cluster_assignment_is_atomic`
- [ ] Run:

```bash
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests/test_v3_analyze.py apps/agent/tests/test_vision_groups.py -q
pnpm --filter @yujee/web exec tsx --test src/app/api/v3/internal/job-progress/route.test.ts src/services/job/job-service.test.ts
```

Expected: report exact current status; do not invent passing coverage.

---

## Task 3: Stage2 Select-Layout And Template Preview Pipeline

**Owner:** Stage2 auditor
**Source docs:** detail-stage2 plus shared `gemini_layout` sections
**Files to inspect:**
- `apps/agent/src/routes.py`
- `apps/agent/src/flows/select_layout.py`
- `apps/agent/src/engine/gemini_layout.py`
- `apps/agent/src/agents/template_select/handler.py`
- `apps/agent/src/engine/skeleton_v3.py`
- `apps/web/scripts/**`
- `packages/contracts/template-previews/**`
- `packages/contracts/src/v3.ts`
- `apps/web/src/services/album/album-service.ts`

- [ ] Verify `/v3/select-layout` exists as async 202 + callback job.
- [ ] Verify `SelectLayoutRequest` includes `chapters[].photos[].{photoId,ref200px,orientation,takenAt}` and does not accept caller-provided candidates.
- [ ] Verify `gemini_layout` internally builds candidates from `legal_candidates` and template preview assets.
- [ ] Verify template preview bake script lives in `apps/web/scripts/` and outputs `packages/contracts/template-previews/`.
- [ ] Verify candidate buckets are per-page capacity union, not whole-chapter-only capacity.
- [ ] Verify legal Gemini slot assignments are preserved; `assign_images_v3` is only fallback for illegal/missing slots.
- [ ] Verify wrap + generic copy runs after interior pages and uses `takenAt`.
- [ ] Required failing tests if missing:
  - `test_select_layout_request_carries_taken_at_without_candidates`
  - `test_gemini_layout_preserves_legal_slot_mapping`
  - `test_template_previews_are_complete_for_interior_templates`
  - `test_select_layout_callback_merges_pages_after_analyze_tree`
- [ ] Run:

```bash
pnpm --filter @yujee/contracts test
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests/test_select_template.py apps/agent/tests/test_skeleton_v3.py -q
```

Expected: audit must state whether Stage2 is absent, partial, or implemented.

---

## Task 4: Stage3 Stateful Edit Agent Loop

**Owner:** Stage3 auditor
**Source docs:** stage3 edit-agent design plus shared agent-DB sections
**Files to inspect:**
- `apps/agent/src/agents/writing/handler.py`
- `apps/agent/src/agents/page_edit/handler.py`
- `apps/agent/src/agents/editing/**`
- `apps/agent/src/ai_client.py`
- `apps/agent/src/routes.py`
- `apps/agent/migrations/**`
- `apps/web/src/app/api/v3/albums/[uuid]/chapter-chat/route.ts`
- `apps/web/src/app/api/v3/albums/[uuid]/edit-chat/route.ts`
- `apps/web/src/services/album/album-service.ts`
- `apps/web/src/lib/agent/agent-client.ts`
- `packages/contracts/src/v3.ts`

- [ ] Verify new `POST /v3/edit-chat` contract replaces chapter-chat/page-edit for Stage3.
- [ ] Verify agent owns history/session/op data in `agent.edit_sessions`, `agent.edit_messages`, `agent.edit_ops`.
- [ ] Verify `opId` and `pending/committed` gating exist, and T-history reads only committed rows.
- [ ] Verify Web applies `patches + pagesTexts + progressDecision` and then calls `POST /internal/agent-ack`.
- [ ] Verify `progressDecision` schema maps to `V3StoryProgress` and `albums.stage` exactly as designed.
- [ ] Verify T4 case4 fetches 200px via `GET /internal/agent-data?type=page-photos` and uses `gemini_layout(mode="case4-swap")`.
- [ ] Required failing tests if missing:
  - `test_edit_chat_response_requires_op_id_for_write_turn`
  - `test_history_reads_only_committed_messages`
  - `test_web_ack_commits_pending_agent_op`
  - `test_case4_fetches_page_photos_via_agent_data`
  - `test_progress_decision_advances_story_projection`
- [ ] Run:

```bash
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests/test_chat_edit_v3.py apps/agent/tests/test_chapter_chat_v3.py -q
pnpm --filter @yujee/web exec tsx --test src/services/album/album-service.test.ts src/lib/agent/agent-client-v3-chapter-chat.test.ts
```

Expected: audit must clearly distinguish existing legacy behavior from PR249 target behavior.

---

## Task 5: Stage4 Book Theme Options

**Owner:** Stage4 auditor
**Source docs:** detail-stage4 plus shared color sections
**Files to inspect:**
- `apps/agent/src/agents/theme_recommend/handler.py`
- `apps/agent/src/agents/theme_recommend/recommend_theme.md`
- `apps/agent/src/prompts/rules/theme_colors.md`
- `apps/agent/src/engine/finalize_color.py`
- `apps/agent/src/engine/apply_theme_v3.py`
- `apps/web/src/services/album/album-service.ts`
- `apps/web/src/components/album/editor-v2/theme-cover-cards-wiring.test.ts`
- `packages/contracts/src/v3.ts`
- `apps/agent/src/schemas.py`

- [ ] Verify recommend response is `bookThemeOptions[3]`, not per-chapter `chapterColors`.
- [ ] Verify each option has `optionId`, `artFont`, `chapters[{chapterId,accentColor,subject?}]`, optional `style/label`.
- [ ] Verify `V3ChapterOverview` carries `extractedColor` to recommend.
- [ ] Verify model path uses DeepSeek text flow, not vision slot.
- [ ] Verify AI color output is normalized through `finalize_color`; `_coerce_accent` is the same responsibility, not a second final-color path.
- [ ] Verify Web expands selected option into existing `V3ChapterThemeChoice[]` for apply-theme.
- [ ] Required failing tests if missing:
  - `test_recommend_returns_three_book_theme_options`
  - `test_recommend_uses_extracted_color_in_overview`
  - `test_web_expands_selected_book_theme_option_to_apply_theme_choices`
- [ ] Run:

```bash
pnpm --filter @yujee/contracts test
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests/test_recommend_v3.py apps/agent/tests/test_apply_theme_v3.py -q
pnpm --filter @yujee/web exec tsx --test src/components/album/editor-v2/theme-cover-cards-wiring.test.ts src/services/album/album-service.test.ts
```

Expected: report whether current Stage4 is legacy `chapterColors` or PR249 `bookThemeOptions`.

---

## Task 6: Stage5 Cover/Ending Final Audit

**Owner:** Stage5 auditor
**Source docs:** detail-stage5 plus chief review B8/M5/M6
**Files to inspect:**
- `apps/agent/src/engine/cover_v3.py`
- `apps/agent/src/routes.py`
- `apps/agent/src/schemas.py`
- `apps/agent/src/engine/accent_color.py`
- `apps/agent/src/engine/finalize_color.py`
- `apps/web/src/services/album/album-service.ts`
- `apps/web/src/app/api/v3/albums/[uuid]/cover/route.ts`
- `packages/contracts/src/v3.ts`

- [ ] Verify `V3CoverRequest` carries `coverPhoto`, `endingPhoto`, `coverPhotoDesc`, `hint`, `userMessage`, `history`, and selected whole-book `artFont`.
- [ ] Verify DeepSeek never receives base64; base64 is only used by code `accent_from_photo`.
- [ ] Verify 5a clarification has `MAX_COVER_CLARIFY_ROUNDS` hard cap.
- [ ] Verify 5b is code extraction plus AI color design plus `finalize_color`, not code extraction as final color.
- [ ] Verify 5c reuses text cleaning/page slot specs and apply-theme color path, then writes page-level `#artFont` carriers for cover/ending pages.
- [ ] Verify Web does not advance cover→ready when `needsUserInput=true`.
- [ ] Required failing tests if missing:
  - `test_cover_copy_prompt_excludes_base64`
  - `test_cover_color_design_receives_extracted_accent_and_desc`
  - `test_cover_theme_carriers_use_request_art_font`
  - `test_cover_turn_needs_input_does_not_advance_stage`
- [ ] Run:

```bash
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests/test_cover_v3.py -q
pnpm --filter @yujee/web exec tsx --test src/services/album/album-service.test.ts src/lib/agent/agent-client-v3-cover.test.ts
```

Expected: include commit evidence for any already-fixed Stage5 item.

---

## Task 7: End-To-End Web Orchestration And PR/Issue Cleanup

**Owner:** coordinator
**Source docs:** all eight PR249 docs
**Files to inspect:**
- `apps/web/src/services/album/album-service.ts`
- `apps/web/src/lib/agent/agent-client.ts`
- `apps/web/src/components/album/editor-v2/**`
- `apps/web/src/app/api/v3/albums/**`
- GitHub issues `#250`-`#254`
- PRs `#249` and `#260`

- [ ] Build a gap matrix that maps each PR249 requirement to one of: implemented in #260, missing, partial, deliberately deferred.
- [ ] Create or update GitHub tasks so Stage1/2/3/4/shared gaps are not hidden inside Stage5 issues.
- [ ] Ensure #260 remains draft and unmerged while rework is in progress.
- [ ] After fixes, run the full verification set:

```bash
pnpm --filter @yujee/contracts test
pnpm --filter @yujee/contracts build
'/Users/smalldog/Desktop/6.5 必搞定/memoir-agent-rebuild/apps/agent/.venv/bin/pytest' apps/agent/tests -q
pnpm --filter @yujee/web test
pnpm --filter @yujee/web typecheck
pnpm --filter @yujee/web build
git diff --check
gh pr checks 260
```

Expected: final report must include the exact commits, tests, and GitHub checks.

---

## Initial Priority

1. Run Tasks 1-6 as read-only audits in parallel.
2. Coordinator consolidates findings into the gap matrix.
3. Create GitHub issue tasks for missing Stage1/2/3/4/shared work.
4. Only implement Stage5 deltas in #260 if they are scoped to #253/#260.
5. Do not merge PR #249 or #260 without explicit user instruction.
