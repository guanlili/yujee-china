import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { creditService } from '@/services/credit/credit-service';
import { mapAgentErrorCode } from '@/lib/api/error-codes';
import {
  AlbumLayoutPlan,
  type AlbumLayoutPlanT,
  Page,
  type PageT,
  PhotoAnalysis,
  type PhotoAnalysisT,
} from '@/lib/agent/layout-schema';
import { z } from 'zod';

// Splice mid-edit-added content pages into a finalized layout, just before the
// ending (the last page), then re-index the ending. Cover/toc and the new pages
// keep their order; only the ending shifts. Photos append (new ids are fresh).
// Pure + exported so the page-ordering invariant is unit-tested without a DB.
export function spliceAddedPages(
  layout: AlbumLayoutPlanT,
  newPhotos: PhotoAnalysisT[],
  newPages: PageT[],
): AlbumLayoutPlanT {
  const ending = layout.pages[layout.pages.length - 1];
  const prefix = layout.pages.slice(0, layout.pages.length - 1);
  const inserted = newPages.map((p, i) => ({ ...p, pageIndex: prefix.length + i }));
  const endingReindexed = { ...ending, pageIndex: prefix.length + inserted.length };
  return {
    ...layout,
    photos: [...layout.photos, ...newPhotos],
    pages: [...prefix, ...inserted, endingReindexed],
  };
}
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
  async markRunning(tx: DbOrTx, jobId: string) {
    // Conditional QUEUED → RUNNING so it can never overwrite a terminal status.
    await agentJobRepo.transitionStatus(tx, jobId, 'RUNNING', ['QUEUED'], { startedAt: new Date() });
  },

  // Read-path resolver for an album's latest job. Returns live stage/progress
  // while the job is genuinely running, and opportunistically sweeps a zombie
  // (RUNNING/QUEUED job with no callback past ZOMBIE_TIMEOUT_MS → FAILED + credit
  // release, via sweepStaleJob). This collapses the worst-case stuck window
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
        // EDITING — the user can just retry finalize. NOT FAILED. No credit work:
        // the charge already settled at init (§6.7), so there is nothing to release.
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

  // ──────────────────────────── v2 (agent rebuild) ────────────────────────────
  // Two async jobs share an album lifecycle, discriminated by agent_jobs.kind:
  // init (Stage 1+3 → draft tree) and finalize (Stage 5 → flat layout). Their
  // failure semantics are OPPOSITE, so every terminal handler branches on kind.
  // The v2 callback envelope (V2Callback) is parsed + kind-cross-checked by the
  // route before these run. rebuild-architecture.md §5 / rebuild-tech-plan §1.1/§1.4.

  // init/finalize both create a QUEUED job; kind is explicit (no DB default).
  async createV2(
    tx: DbOrTx,
    input: { userId: string; albumId: string; requestId: string; kind: 'init' | 'finalize' | 'add' },
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
  // ("draft ready"). layout_json stays null (the draft-vs-finalized discriminator).
  // CHARGE-AT-INIT (§6.7): this is where the single credit charge lands — settle the
  // init hold in the SAME tx as the draft write + job marker (invariant 8), so a
  // successful generation debits exactly once. A failed/zombie init releases the hold
  // instead (handleV2Failed / sweepStaleJob) → never charged.
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

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on init completed');
      return;
    }

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

      // The single charge lands here (the init hold created at submit time). settle
      // is idempotent on an already-settled/missing hold, so a double-delivered
      // callback that loses the transition race above never double-debits.
      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
    });
  },

  // finalize/completed → flatten into album_pages + layout_json in one tx. album →
  // EDITING (finalized: editable/exportable), NOT COMPLETED — that stays with PDF
  // upload confirmation (§1.4). No charge here: §6.7 moved the single charge to
  // init-success, so finalize is purely re-rendering the already-paid-for draft.
  async handleFinalizeCompleted(requestId: string, rawLayout: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.kind !== 'finalize') {
      logger.error({ requestId, kind: job.kind }, 'finalize-completed callback on non-finalize job');
      return;
    }
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    // Defence in depth: re-validate against the flat contract before persisting
    // (the route already parsed V2Callback, but the flat layout is what hits
    // album_pages — keep a guard right before the DB write).
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
          // #165: position overrides flatten through finalize (inv 12). Absent =>
          // {} so the row renders at the historical 50/50/1 default.
          imagePosJson: p.imagePos ?? {},
        })),
      );

      // No credit work here (§6.7 charge-at-init): the single charge already settled
      // when the init job completed. Finalize only re-renders the paid-for draft into
      // the flat layout — the hold this album points at is already SETTLED.
    });
  },

  // add/completed (W11 mid-edit add-photos) → splice the new pages in before the
  // ending, rebuild album_pages + layout_json, settle the add hold. The album never
  // left EDITING (the editor stays mounted and injects the pages live), so there's
  // no status flip here — only the page set + the single add charge land.
  async handleAddCompleted(
    requestId: string,
    rawNewPhotos: unknown,
    rawNewPages: unknown,
    usage: unknown,
  ) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.kind !== 'add') {
      logger.error({ requestId, kind: job.kind }, 'add-completed callback on non-add job');
      return;
    }
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    // Defence in depth (mirrors handleFinalizeCompleted): re-validate the appended
    // photos/pages before they hit album_pages, even though the route parsed them.
    const photosParsed = z.array(PhotoAnalysis).safeParse(rawNewPhotos);
    const pagesParsed = z.array(Page).min(1).safeParse(rawNewPages);
    if (!photosParsed.success || !pagesParsed.success) {
      const issues = [...(photosParsed.success ? [] : photosParsed.error.issues), ...(pagesParsed.success ? [] : pagesParsed.error.issues)];
      logger.error({ requestId, issues }, 'v2 add-photos output invalid');
      await this.handleV2Failed(requestId, {
        code: 'AGENT_INVALID_OUTPUT',
        message: issues.map((i) => i.message).join('; '),
      });
      return;
    }

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on add completed');
      return;
    }
    const layoutParsed = AlbumLayoutPlan.safeParse(album.layoutJson);
    if (!layoutParsed.success) {
      // add-photos only runs on a finalized album; a missing/invalid layout means
      // the album changed under us — fail the add (refunds the hold) and bail.
      logger.error({ requestId, albumId: job.albumId }, 'add-photos on album without valid layout');
      await this.handleV2Failed(requestId, { code: 'ALBUM_NOT_EDITABLE', message: 'Album is not finalized' });
      return;
    }
    const layout = layoutParsed.data;

    // Splice the new content pages in before the ending and re-index (pure helper,
    // unit-tested for the page-ordering invariant).
    const newLayout = spliceAddedPages(layout, photosParsed.data, pagesParsed.data);
    const mergedPages = newLayout.pages;

    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'skeleton',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      await albumRepo.update(tx, job.albumId, {
        layoutJson: newLayout,
        pageCount: mergedPages.length,
      });
      // Pages slot before the ending → its pageIndex shifts; rebuild the whole set
      // to dodge the unique(albumId, pageIndex) index (deleteByAlbum + bulkInsert).
      await albumPageRepo.deleteByAlbum(tx, job.albumId);
      await albumPageRepo.bulkInsert(
        tx,
        mergedPages.map((p) => ({
          albumId: job.albumId,
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: p.images,
          textsJson: p.texts,
          // #165: preserve existing pages' overrides; new add-photos pages have none.
          imagePosJson: p.imagePos ?? {},
        })),
      );

      // The single add charge lands here (the add hold created at submit time).
      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
    });
  },

  // ──────────────────────────── v3 (五环节状态机, WP1.1) ────────────────────────────
  // The /v3/analyze async job reuses the existing init lifecycle: it creates the
  // album draft (draft_json) and settles the credit charge on success, releases on
  // failure — identical to v2 init. To avoid a schema migration on agent_jobs.kind
  // (architect-gated), the v3 analyze job is stored as kind='init'; the V3Callback
  // envelope carries jobKind='analyze' and the v3 job-progress handler maps the two.
  //
  // SEAM(WP1.5 通用文案/色+预览+settle复用): WP1.5 owns advancing albums.stage
  // (analysing → story) once the generic-copy preview tree lands, and any richer
  // settle/stage orchestration. WP1.1 only wires the round-trip: write the tree to
  // draft_json + settle (reuse) + album EDITING; albums.stage stays 'analysing'
  // (its default), so a failed/retried analyze never pollutes the stage column
  // (acceptance: 失败可重试不污染 stage).

  // analyze/progress → reuse the generic progress heartbeat (stage is just a label).
  async handleV3Progress(requestId: string, stage: string, progress: number) {
    await this.handleProgress(requestId, stage, progress);
  },

  // analyze/completed → write the V3 章节树 + preview pages to draft_json + settle
  // the init hold in the SAME tx + album EDITING (mirrors handleInitCompleted; the
  // route is the single V3Callback validation). The credit
  // charge settles here exactly once (§6.7 charge-at-init); a double-delivered
  // callback loses the terminal transition race and never double-debits.
  async handleV3AnalyzeCompleted(requestId: string, tree: unknown, pages: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return; // idempotent: late callback after the row is gone
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 analyze completed');
      return;
    }

    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'preview',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      const draftJson =
        tree && typeof tree === 'object' && !Array.isArray(tree)
          ? { ...(tree as Record<string, unknown>), pages }
          : { tree, pages };

      await albumRepo.update(tx, job.albumId, {
        status: 'EDITING',
        draftJson,
        // albums.stage stays 'analysing' here — WP1.5 advances it to 'story' once the
        // preview tree carries generic copy/colors. Keeping it untouched means a
        // failed-then-retried analyze never moves the stage forward prematurely.
      });

      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
    });
  },

  // analyze/failed → album FAILED + release the hold (no draft to keep, mirrors the
  // init failure fork). albums.stage is left at 'analysing', so the retriable failed
  // card reruns analyze from the same stage (失败可重试不污染 stage).
  async handleV3Failed(requestId: string, error: { code: string; message: string }) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    const mapped = { code: mapAgentErrorCode(error.code), message: error.message };
    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'FAILED', ['QUEUED', 'RUNNING'], {
        error: mapped,
        completedAt: new Date(),
      });
      if (!won) return;
      await albumRepo.update(tx, job.albumId, { status: 'FAILED', errorMessage: error.message });
      await creditService.releaseByAlbum(tx, job.albumId);
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
        return; // no credit work — the charge already settled at init (§6.7)
      }

      if (job.kind === 'add') {
        // The album never left EDITING (it's a finalized album the user is editing);
        // a failed add must not destroy it. Just refund the add hold — no charge for
        // work that didn't land.
        await creditService.releaseByAlbum(tx, job.albumId);
        return;
      }

      await albumRepo.update(tx, job.albumId, {
        status: 'FAILED',
        errorMessage: error.message,
      });
      await creditService.releaseByAlbum(tx, job.albumId);
    });
  },
};
