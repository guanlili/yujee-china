# T-Integration — end-to-end stack verification

Issue #28 (migration-plan §7). The 11 batches each passed isolated acceptance, but
had never run together in one live stack. This is the record of bringing the whole
stack up locally, running the core user journey for real, and fixing the seams that
only break when the batches are wired together.

- Branch: `chore/t-integration` (base `main` @ 9bd720d = all 11 batches)
- Agent mode: `AGENT_PIPELINE_MODE=mock` (real 火山/DeepSeek left to T-Deploy)
- Date: 2026-05-28

## Stack brought up

No Docker on this machine, so Postgres is the local Homebrew `postgresql@15` already
running on 5432. Node must be nvm's (the `Codex.app` node on PATH breaks Next's
native deps).

```bash
# Postgres: role yujee / db yujee_dev already provisioned to match env.ts default
#   DATABASE_URL=postgresql://yujee:yujee@localhost:5432/yujee_dev

# deps + migrations + seed  (nvm node!)
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
pnpm install
pnpm --filter @yujee/web db:migrate          # applies 0000 + 0001 (idempotent, journal-checked)
pnpm --filter @yujee/web db:seed              # demo user

# Agent (mock)  — apps/agent/.env: AGENT_SHARED_SECRET=dev_secret_replace_me, AGENT_PIPELINE_MODE=mock
cd apps/agent && source .venv/bin/activate && uvicorn src.main:app --host 127.0.0.1 --port 8001

# Web — apps/web/.env: DATABASE_URL, AGENT_SHARED_SECRET (must match agent), WEB_BASE_URL=http://localhost:3100
#   NOTE: do NOT `source .env` (AUTH_EMAIL_FROM has < > which the shell parses) — Next loads it.
#   Pinned to :3100 so agent→web callbacks (WEB_BASE_URL) hit THIS server.
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
cd apps/web && pnpm exec next dev --port 3100
```

Both health checks green: agent `GET /health` → `{ok:true}`; web `GET /api/v1/health` → `{ok:true}`.

## Core journey — verified end to end

Run with a verified test user (`integ-test@yujee.local`) and an admin
(`integ-admin@yujee.local`, `is_admin` flipped via SQL — seeded users have no
better-auth account row so the real signup flow is used).

| Step | How | Result |
|---|---|---|
| Register | `POST /api/auth/sign-up/email` | 200, `emailVerified:false`, `creditBalance:1000` |
| Email verify | capture file `apps/web/.tmp/email-capture.jsonl` → `GET /verify-email?token=…` | 200, session cookie set (auto sign-in) |
| Login (UI) | `/en/login` form in headless browser | redirects to `/en/my-albums` (after fix) |
| Create → generate | `POST /api/v1/jobs` (3–30 photos, base64) | 200, album + job + hold committed in one tx |
| Poll | `GET /api/v1/jobs/[requestId]` | RUNNING → COMPLETED (~1–4s, mock) |
| Album render | `/en/album/[uuid]` in headless browser | mag-13 cover + 2× mag-02 spreads render, **0 console errors** |
| Edit page | `PATCH /api/v1/albums/[uuid]/pages/0` (text + image swap) | 200, `album_pages` updated |
| Chat edit | `POST /api/v1/albums/[uuid]/chat` | 200, layoutPatch + assistantReply, `album_messages` user+assistant rows |
| Export PDF | `POST …/pdf-upload-url` → `PUT …/pdf` → `GET …/pdf` | presigned PUT to R2, metadata saved, status COMPLETED |
| My albums | `GET /api/v1/albums` | lists all albums + status |
| Credits | `GET /api/v1/credit/history` | HOLD(0) + SETTLE(−200) rows, balance correct |
| Admin | `POST /api/v1/admin/recover-stuck`, `/en/admin/users` | admin 200, non-admin 403, unauth 401 |

## Cross-batch seams — verified

- **Credit hold→settle:** generate debits exactly `CREDIT_COST_PER_ALBUM` (200). Ledger:
  `GENERATION_HOLD`(Δ0) then `GENERATION_SETTLE`(Δ−200); hold row `SETTLED`. Balance 1000→800→600 over two albums.
- **Failure path:** agent unreachable → album `FAILED`, hold `RELEASED`, **no debit** (balance unchanged),
  ledger `GENERATION_HOLD`(0)+`GENERATION_RELEASE`(0). Atomic.
- **Original image red-line:** `/create` Canvas-downscales to 800px `toDataURL('image/jpeg',0.6)` and
  POSTs JSON `{photoId,base64,w,h}`; the original `File` stays browser-only in IndexedDB (`photoStore`).
  DB scan: **0 rows** containing `data:image`/`base64` across albums/album_pages/agent_jobs/album_messages;
  `images_json` holds photoId refs only. Invariants 1 & 2 hold.
- **PDF red-line:** presigned PUT URL targets `…r2.cloudflarestorage.com` (signed, `X-Amz-Signature`),
  never the web origin. Web never sees PDF bytes. Invariant 4 holds.
- **Adaptor seam:** mag-02 `items` arrives as a string from the mock; `adapt-layout.ts` reads the
  contract's `type:'array'` slot metadata and wraps it (`toArrayItems`). Browser render of mag-02 (and
  mag-13) is crash-free. mag-10 `cells` is declared array in contracts too.
- **R2:** no real R2 here — exercised with dummy creds to prove the presign/confirm/metadata path; the
  actual byte upload is a T-Deploy item.

## Bugs found and fixed (one commit each)

1. **`fix(agent): accept contract-compliant layouts in chat-edit`** — Agent `PhotoAnalysis` made
   `peopleCount/scene/mood` required, but the canonical `@yujee/contracts` PhotoAnalysis (and the Web zod
   mirror) define only 5 fields. Web stores the layout through that 5-field zod (dropping the extras),
   then sends it back on `/v1/chat-edit`, where the Agent rejected it (400 → 502 `AGENT_CHAT_FAILED`).
   Made the vision-extension fields optional. **Blocks chat in prod, not just mock.**
2. **`feat(agent): mock path for chat-edit`** — `chat_edit.run()` hard-required a DeepSeek key with no
   mock branch (unlike vision_mock/planning_mock), so the chat seam couldn't be tested offline. Added a
   deterministic, structurally-valid mock patch (rules intentionally skipped — mock layouts are smoke
   fixtures that don't satisfy every rule).
3. **`fix(web): make login/register actually sign users in`** — both pages were server-rendered native
   `<form method=post action=/api/auth/*>`. better-auth returns 200 JSON (not a 3xx), so a real browser
   submit landed on the raw JSON response — authenticated but stranded, never reaching the app. Converted
   to client components using the better-auth client + redirect. **Broke step 1 for every browser user.**
4. **`fix(web): new users get free-plan credits, not an unusable 100`** — signup seeded
   `creditBalance=100` but an album costs 200, so no new user could generate. Set the default to
   `FREE_PLAN_CREDITS` (1000, the free plan's intended grant).

Plus `test(web): assert signup grants FREE_PLAN_CREDITS` to keep the test in sync.

## Health

`/health` composite: **10.0 / 10** (target ≥ 8).

- Typecheck (contracts + web): 0 errors → 10/10
- Tests: web 32 pass / 0 fail / 1 skip · contracts 4/4 · agent 38/38 → 10/10
- Lint / dead-code / shell-lint: no tooling configured in repo → not scored (weight redistributed)

## Verified locally vs must verify at T-Deploy

**Verified locally (mock stack):**
- Full journey register → verify → login → create → generate → poll → render → edit → chat → PDF metadata → my-albums → credits → admin
- Credit hold/settle/release accounting + atomicity
- Original-image and PDF-bytes red-lines
- Adaptor seam render (mag-02/mag-13) with zero console errors
- Auth gating (401/403/200) on admin routes
- Migrations 0000+0001 apply cleanly; all test suites + typecheck green

**Must verify at T-Deploy (needs real services / keys):**
- **R2:** real presigned PUT + browser byte upload + public CDN fetch (only dummy-cred signing tested here)
- **Real chat-edit:** DeepSeek-backed `/v1/chat-edit` (mock returns a no-op patch; real model + `layout_rules` enforcement unverified)
- **Real layout generation:** 火山 doubao-vision + DeepSeek planning (mock planner is a smoke fixture and does NOT satisfy `layout_rules` — e.g. unused photos, cover title > maxChars; real planner must)
- **Stripe / Creem:** checkout + webhook credit top-ups (no keys locally; PURCHASE path unexercised)
- **Email:** real Resend delivery (ran in `capture` mode)
- **PDF Chinese font** (#19) and **Agent error codes** (#20): owned by the pre-launch window, not re-done here.

## Follow-ups (noted, not fixed here)

- **SIGNUP_BONUS ledger row:** the `SIGNUP_BONUS` reason is defined but never written — the opening
  balance bypasses the credit_ledger, so balance ≠ ledger sum for new users. Writing it from a
  `user.create.after` hook fails (the drizzle adapter's create transaction hasn't committed the user row;
  the UPDATE sees 0 rows and rolls signup back). Needs a post-commit / post-verification hook.
- **Generation vs chat-edit rule asymmetry:** layout generation never runs `layout_rules`, but chat-edit
  validates the full layout — so any non-conformant generated layout blocks chat. Low risk with the real
  planner; worth a guard at generation time.
