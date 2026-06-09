import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { creditService } from '@/services/credit/credit-service';
import { ERRORS, mapAgentErrorCode } from '@/lib/api/error-codes';
import { AlbumLayoutPlan, type AlbumLayoutPlanT } from '@/lib/agent/layout-schema';
import { logger } from '@/lib/log/logger';

// Just over the Agent's background_task_timeout_seconds=180 (docs/agent/design.md
// §7): a job with no progress/terminal callback past this is definitively dead.
// Shared by the daily recover-stuck cron and the read-path opportunistic sweep.
const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000;

// What album-service learns about an album's latest job on the read path.
export type GenerationResolution =
  | { kind: 'progress'; stage: string | null; progress: number } // running, fresh
  | { kind: 'swept' } // was a zombie — just transitioned to FAILED in here
  | null; // no job, or already terminal (the album row already tells the truth)

export const jobService = {
  async create(tx: DbOrTx, input: { userId: string; albumId: string; requestId: string }) {
    const job = await agentJobRepo.create(tx, {
      userId: input.userId,
      albumId: input.albumId,
      requestId: input.requestId,
      status: 'QUEUED',
      progress: 0,
    });
    return job;
  },

  async markRunning(tx: DbOrTx, jobId: string) {
    // Conditional QUEUED → RUNNING so it can never overwrite a terminal status.
    await agentJobRepo.transitionStatus(tx, jobId, 'RUNNING', ['QUEUED'], { startedAt: new Date() });
  },

  async findStatus(userId: string, requestId: string) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) throw ERRORS.JOB_NOT_FOUND();
    if (job.userId !== userId) throw ERRORS.JOB_NOT_OWNED();
    return {
      requestId: job.requestId,
      albumId: job.albumId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      error: job.error ?? null,
    };
  },

  // Read-path resolver for an album's latest job. Returns live stage/progress
  // while the job is genuinely running, and opportunistically sweeps a zombie
  // (RUNNING/QUEUED job with no callback past ZOMBIE_TIMEOUT_MS → FAILED + credit
  // release, reusing handleFailed). This collapses the worst-case stuck window
  // from "until the daily cron" down to "≤5 min after the user next looks".
  // The album row stays the source of truth; this only enriches/corrects it.
  async resolveGeneration(albumId: string, now: Date = new Date()): Promise<GenerationResolution> {
    const job = await agentJobRepo.findLatestByAlbum(albumId);
    if (!job) return null;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return null;
    // startedAt is refreshed on every progress callback (handleProgress), so it's
    // a last-activity heartbeat — this measures "no progress for ZOMBIE_TIMEOUT_MS",
    // NOT total runtime. A job still emitting progress keeps itself alive. QUEUED
    // has no startedAt yet, so fall back to createdAt: a job the Agent never
    // accepted still ages out.
    const since = job.startedAt ?? job.createdAt;
    if (now.getTime() - since.getTime() > ZOMBIE_TIMEOUT_MS) {
      // Looks stale from this snapshot — confirm + fail under a row lock so a
      // progress heartbeat racing this read can't be clobbered. If sweepStaleJob
      // re-reads fresh activity it declines, and we just report progress instead.
      const { swept } = await this.sweepStaleJob(job.id, now);
      if (swept) return { kind: 'swept' };
    }
    return { kind: 'progress', stage: job.stage, progress: job.progress };
  },

  // The authoritative zombie transition: lock the job row, re-check staleness
  // under the lock, then fail the job + album + release the hold in one tx. The
  // FOR UPDATE re-read closes the time-of-check/time-of-use gap — a heartbeat or
  // terminal callback either committed before us (we see it and decline) or
  // serializes behind our lock (then finds the row already FAILED). Reused by the
  // read-path sweep (ZOMBIE_TIMEOUT_MS) and the daily cron (its own timeoutMs).
  async sweepStaleJob(
    jobId: string,
    now: Date,
    timeoutMs: number = ZOMBIE_TIMEOUT_MS,
  ): Promise<{ swept: boolean; releasedHold: boolean }> {
    return db.transaction(async (tx) => {
      const job = await agentJobRepo.findByIdForUpdate(tx, jobId);
      if (!job) return { swept: false, releasedHold: false };
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        return { swept: false, releasedHold: false };
      }
      const since = job.startedAt ?? job.createdAt;
      if (now.getTime() - since.getTime() <= timeoutMs) {
        return { swept: false, releasedHold: false }; // a heartbeat refreshed it — still alive
      }

      // The job is dead regardless of kind → mark it FAILED. The album/credit
      // fork is OPPOSITE per agent_jobs.kind (rebuild-architecture.md §5):
      await agentJobRepo.update(tx, job.id, {
        status: 'FAILED',
        error: { code: 'AGENT_TIMEOUT', message: `${job.status} > ${timeoutMs}ms without callback` },
        completedAt: now,
      });

      if (job.kind === 'finalize') {
        // finalize zombie: the draft is still intact, so the album returns to
        // EDITING and the hold stays HOLDING — the user can just retry finalize.
        // NOT FAILED, NOT released (unlike init).
        await albumRepo.update(tx, job.albumId, { status: 'EDITING' });
        return { swept: true, releasedHold: false };
      }

      // init zombie (and legacy v1 jobs, which default to kind='init'): no draft
      // to fall back to, so the album fails and the reservation is released.
      const album = await albumRepo.findById(job.albumId);
      const holdId = album?.creditHoldId ?? null;
      await albumRepo.update(tx, job.albumId, {
        status: 'FAILED',
        errorMessage: 'Generation timed out. No credit was charged.',
      });
      if (holdId) await creditService.release(tx, holdId);

      return { swept: true, releasedHold: !!holdId };
    });
  },

  async handleProgress(requestId: string, stage: string, progress: number) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return; // idempotent: callback after completion can be dropped
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // fast path
    // Conditional: advance progress only while still non-terminal. A progress
    // callback that overlaps completion/failure must NOT resurrect a terminal job
    // back to RUNNING — otherwise the stale-sweep would later fail a done album.
    // The WHERE re-checks committed status, so a terminal transition that landed
    // after our read wins and this becomes a no-op.
    await agentJobRepo.transitionStatus(db, job.id, 'RUNNING', ['QUEUED', 'RUNNING'], {
      stage,
      progress,
      // Refresh startedAt on every progress — it doubles as a liveness heartbeat
      // (see resolveGeneration / findStaleRunning). A job still reporting progress
      // keeps bumping this, so the 5-min staleness check measures time since the
      // LAST activity, not total runtime — a slow-but-alive job is never swept.
      startedAt: new Date(),
    });
  },

  async handleCompleted(requestId: string, rawLayout: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    const parsed = AlbumLayoutPlan.safeParse(rawLayout);
    if (!parsed.success) {
      logger.error({ requestId, issues: parsed.error.issues }, 'agent layout invalid');
      await this.handleFailed(requestId, {
        code: 'AGENT_INVALID_OUTPUT',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }
    const layout: AlbumLayoutPlanT = parsed.data;

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on completed');
      return;
    }

    // Invariant 8: layout write + page bulk insert + credit settle + job marker
    // commit together so partial failure cannot leave the user charged-but-no-album.
    await db.transaction(async (tx) => {
      // Win the job transition first; if a concurrent failed/sweep already moved
      // it off QUEUED/RUNNING, bail before touching the album — and the row lock
      // also blocks a double-delivered callback from inserting pages twice.
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'composing',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      await albumRepo.update(tx, job.albumId, {
        title: layout.magazine.title,
        status: 'EDITING',
        layoutJson: layout,
        pageCount: layout.pages.length,
      });

      await albumPageRepo.bulkInsert(
        tx,
        layout.pages.map((p) => ({
          albumId: job.albumId,
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: p.images,
          textsJson: p.texts,
        })),
      );

      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
    });
  },

  async handleFailed(requestId: string, error: { code: string; message: string }) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    await db.transaction(async (tx) => {
      // Win the job transition first. If a concurrent completed callback already
      // moved it off QUEUED/RUNNING (the read-path sweep racing a late success),
      // bail before flipping the album to FAILED or releasing a settled hold.
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'FAILED', ['QUEUED', 'RUNNING'], {
        error,
        completedAt: new Date(),
      });
      if (!won) return;

      await albumRepo.update(tx, job.albumId, {
        status: 'FAILED',
        errorMessage: error.message,
      });

      await creditService.releaseByAlbum(tx, job.albumId);
    });
  },

  // ──────────────────────────── v2 (agent rebuild) ────────────────────────────
  // Two async jobs share an album lifecycle, discriminated by agent_jobs.kind:
  // init (Stage 1+3 → draft tree) and finalize (Stage 5 → flat layout). Their
  // failure semantics are OPPOSITE, so every terminal handler branches on kind.
  // The v2 callback envelope (V2Callback) is parsed + kind-cross-checked by the
  // route before these run. rebuild-architecture.md §5 / rebuild-tech-plan §1.1/§1.4.

  // init/finalize both create a QUEUED job; kind is explicit (no DB default).
  async createV2(
    tx: DbOrTx,
    input: { userId: string; albumId: string; requestId: string; kind: 'init' | 'finalize' },
  ) {
    return agentJobRepo.create(tx, {
      userId: input.userId,
      albumId: input.albumId,
      requestId: input.requestId,
      kind: input.kind,
      status: 'QUEUED',
      progress: 0,
    });
  },

  // init/completed → write the authoring tree to draft_json + album EDITING
  // ("draft ready"). layout_json stays null (the draft-vs-finalized discriminator)
  // and the hold stays HOLDING — settle is deferred to finalize (§5). NOT settled.
  // draftTree is already V2Callback-validated by the route; it lands as-is in the
  // draft_json jsonb column (typed unknown — the route is the single validation).
  async handleInitCompleted(requestId: string, draftTree: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return; // idempotent: late callback after the row is gone
    if (job.kind !== 'init') {
      logger.error({ requestId, kind: job.kind }, 'init-completed callback on non-init job');
      return;
    }
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    await db.transaction(async (tx) => {
      // Win the terminal transition first; a concurrent failed/sweep that already
      // moved it off QUEUED/RUNNING means we bail before touching the album, and
      // the row lock blocks a double-delivered callback from writing twice.
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'skeleton',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      await albumRepo.update(tx, job.albumId, {
        status: 'EDITING',
        draftJson: draftTree,
      });
    });
  },

  // finalize/completed → flatten into album_pages + layout_json + settle the hold,
  // all in one tx (invariant 8). album → EDITING (finalized: editable/exportable),
  // NOT COMPLETED — that stays with PDF upload confirmation (§1.4). Opposite of
  // init: this is where the single charge lands.
  async handleFinalizeCompleted(requestId: string, rawLayout: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.kind !== 'finalize') {
      logger.error({ requestId, kind: job.kind }, 'finalize-completed callback on non-finalize job');
      return;
    }
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    // Defence in depth: re-validate against the flat contract before persisting,
    // mirroring v1 handleCompleted (the route already parsed V2Callback, but the
    // flat layout is what hits album_pages — keep the same guard the v1 path has).
    const parsed = AlbumLayoutPlan.safeParse(rawLayout);
    if (!parsed.success) {
      logger.error({ requestId, issues: parsed.error.issues }, 'v2 finalize layout invalid');
      await this.handleV2Failed(requestId, {
        code: 'AGENT_INVALID_OUTPUT',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }
    const layout: AlbumLayoutPlanT = parsed.data;

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on finalize completed');
      return;
    }

    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'finalize',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      await albumRepo.update(tx, job.albumId, {
        title: layout.magazine.title,
        status: 'EDITING',
        layoutJson: layout,
        pageCount: layout.pages.length,
      });

      await albumPageRepo.bulkInsert(
        tx,
        layout.pages.map((p) => ({
          albumId: job.albumId,
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: p.images,
          textsJson: p.texts,
        })),
      );

      // settle whatever credit_hold_id currently points at (W7b guarantees it is
      // a HOLDING hold at this point via finalize intake; settle is a no-op on a
      // null/already-settled hold, so this is safe before W7b lands).
      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
    });
  },

  // */failed → fork on kind. init: album FAILED + release (no draft to keep).
  // finalize: album back to EDITING + hold stays HOLDING (retry-able) — the draft
  // is untouched, so we never FAILED it nor release the reservation (§5).
  async handleV2Failed(requestId: string, error: { code: string; message: string }) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    // Inbound boundary for agent-reported codes (rebuild-tech-plan §1.6, P2-8):
    // normalize the contract.md §8 namespace to error-codes.ts before persisting,
    // so AGENT_OUTPUT_VALIDATION lands as AGENT_INVALID_OUTPUT in agent_jobs.error
    // and albums.error_message. Pass-through for codes shared by both sides.
    const mapped = { code: mapAgentErrorCode(error.code), message: error.message };

    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'FAILED', ['QUEUED', 'RUNNING'], {
        error: mapped,
        completedAt: new Date(),
      });
      if (!won) return;

      if (job.kind === 'finalize') {
        await albumRepo.update(tx, job.albumId, { status: 'EDITING' });
        return; // keep the hold; do not release
      }

      await albumRepo.update(tx, job.albumId, {
        status: 'FAILED',
        errorMessage: error.message,
      });
      await creditService.releaseByAlbum(tx, job.albumId);
    });
  },
};
