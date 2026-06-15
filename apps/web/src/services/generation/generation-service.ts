import { db } from '@/db/client';
import { albumService } from '@/services/album/album-service';
import { jobService } from '@/services/job/job-service';
import { creditService } from '@/services/credit/credit-service';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { AlbumDraft, type V2InitRequest, type V2AddPhotosRequest } from '@yujee/contracts';

// Browser → /api/v2/albums init payload (originals as base64, invariant 1). The
// route generates nothing the browser owns except photo bytes; requestId is the
// client's idempotency key.
type V2InitInput = {
  requestId: string;
  language: 'zh' | 'en';
  promptHint?: string;
  photos: Array<{
    photoId: string;
    base64: string;
    width: number;
    height: number;
    takenAt?: string | null;
  }>;
};

// Browser → /api/v2/albums/[uuid]/add-photos. The NEW photos only (base64); the
// album is identified by the URL. Same per-book gate as creation (a fresh hold).
type V2AddPhotosInput = {
  requestId: string;
  language: 'zh' | 'en';
  promptHint?: string;
  photos: Array<{
    photoId: string;
    base64: string;
    width: number;
    height: number;
    takenAt?: string | null;
  }>;
};

type RetryInput = {
  requestId: string;
  language: 'zh' | 'en';
  photos: AgentPhotoInput[];
};

export const generationService = {
  // ──────────────────────────── v2 (agent rebuild) ────────────────────────────

  // POST /api/v2/albums — start the init job (Stage 1+3). Creates the album
  // (AGENT_RUNNING) + the kind=init job, then forwards the base64 to the agent.
  // The completed callback writes draft_json (jobService.handleInitCompleted).
  //
  // credit precheck + hold live INSIDE this transaction (album + job + reservation
  // commit atomically, invariant 8). precheck runs first so an insufficient balance
  // throws CREDIT_INSUFFICIENT and rolls the whole tx back before any album/job row
  // is written (§6.5 decision 2 → front-end /pricing).
  // CHARGE-AT-INIT (§6.7): the single charge settles when this init job SUCCEEDS
  // (jobService.handleInitCompleted), not at finalize. A failed/zombie init releases
  // the hold (handleV2Failed / sweepStaleJob) — never charged. Cost scales with the
  // photo count: creditsForPhotos(N).
  async submitInitV2(userId: string, input: V2InitInput) {
    const amount = creditService.cost(input.photos.length);
    await creditService.precheck(userId, amount);

    const placeholderTitle =
      input.promptHint?.trim().slice(0, 40) || (input.language === 'zh' ? '我的故事' : 'My Memoir');

    const { albumId } = await db.transaction(async (tx) => {
      const album = await albumService.create(tx, {
        userId,
        prompt: input.promptHint ?? '',
        photoCount: input.photos.length,
        title: placeholderTitle,
      });
      await jobService.createV2(tx, {
        userId,
        albumId: album.albumId,
        requestId: input.requestId,
        kind: 'init',
      });
      // hold creates the credit_holds row (HOLDING) and points albums.credit_hold_id
      // at it — the same pointer finalize-settle later resolves (invariant 8).
      await creditService.hold(tx, userId, amount, album.albumId);
      return album;
    });

    return dispatchInitV2(albumId, input);
  },

  // POST /api/v2/albums/[uuid]/retry — retry a FAILED v2 album by reusing the SAME
  // albumId (§6.5.3): no new album, the failed card just reruns init (Stage 1+3).
  // In v2 only an init failure leaves an album FAILED (finalize failures roll back
  // to EDITING and retry from the editor), so a FAILED card always reruns init.
  // The old hold was released on failure, so we run a fresh precheck + hold under a
  // new requestId; the browser resends the base64 (invariant 1). promptHint comes
  // from the stored album so the rerun stays faithful to the original story.
  async retryV2(userId: string, albumId: string, input: RetryInput) {
    const album = await albumService.findOwned(userId, albumId);
    const amount = creditService.cost(input.photos.length);
    await creditService.precheck(userId, amount);

    // Claim FAILED → AGENT_RUNNING, create the new kind=init job, and hold credit
    // together (invariant 8). setRetrying throws ALBUM_NOT_RETRIABLE if the album
    // isn't FAILED (already running / lost a concurrent retry), rolling the tx back
    // before any hold is taken.
    await db.transaction(async (tx) => {
      await albumService.setRetrying(tx, albumId);
      await jobService.createV2(tx, { userId, albumId, requestId: input.requestId, kind: 'init' });
      await creditService.hold(tx, userId, amount, albumId);
    });

    return dispatchInitV2(albumId, {
      requestId: input.requestId,
      language: input.language,
      photos: input.photos,
      ...(album.prompt ? { promptHint: album.prompt } : {}),
    });
  },

  // POST /api/v2/albums/[uuid]/finalize — start the finalize job (Stage 5). Reads
  // the authoring tree from draft_json, flips the album to AGENT_RUNNING
  // ("completing"), creates the kind=finalize job, and forwards the tree. The
  // completed callback flattens it (jobService.handleFinalizeCompleted).
  //
  // CHARGE-AT-INIT (§6.7): the single credit charge already landed at init-success
  // (handleInitCompleted settle). Finalize is just re-rendering the paid-for draft
  // into a flat layout — it does NOT hold or charge again. The compare-and-swap
  // lock (EDITING AND draft_json IS NOT NULL AND layout_json IS NULL → AGENT_RUNNING)
  // + the partial unique index on (album_id, kind) still guard a double-finalize.
  async submitFinalizeV2(userId: string, albumId: string) {
    const album = await albumService.findOwned(userId, albumId);
    if (album.layoutJson) throw ERRORS.ALBUM_NOT_EDITABLE(); // already finalized

    const parsed = AlbumDraft.safeParse(album.draftJson);
    if (!parsed.success) throw ERRORS.ALBUM_NOT_EDITABLE(); // no/invalid draft to finalize
    const draftTree = parsed.data;

    const requestId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      // EDITING → AGENT_RUNNING claims the album so a double-click can't start two
      // finalize jobs. No credit work here — the charge already settled at init.
      const won = await albumRepo.transitionStatus(tx, albumId, 'AGENT_RUNNING', ['EDITING']);
      if (!won) throw ERRORS.ALBUM_NOT_EDITABLE();
      await jobService.createV2(tx, { userId, albumId, requestId, kind: 'finalize' });
    });

    return dispatchFinalizeV2(albumId, requestId, draftTree);
  },

  // POST /api/v2/albums/[uuid]/add-photos (W11 mid-edit add) — append new pages to a
  // FINALIZED album. A fresh per-book hold (the prior init/finalize hold is already
  // settled), a kind=add job, then dispatch. The album stays EDITING the whole time
  // (the editor stays mounted and injects the new pages when the job completes); the
  // partial unique index on (album_id, kind) blocks a concurrent double-add.
  async submitAddPhotosV2(userId: string, albumId: string, input: V2AddPhotosInput) {
    const album = await albumService.findOwned(userId, albumId);
    if (!album.layoutJson) throw ERRORS.ALBUM_NOT_EDITABLE(); // only finalized albums take new pages

    const amount = creditService.cost(input.photos.length);
    await creditService.precheck(userId, amount);

    await db.transaction(async (tx) => {
      await jobService.createV2(tx, { userId, albumId, requestId: input.requestId, kind: 'add' });
      // A new HOLDING hold for this add; settle lands at add-completion. Overwrites
      // albums.credit_hold_id (the prior hold is already settled, so it's free).
      await creditService.hold(tx, userId, amount, albumId);
    });

    return dispatchAddPhotosV2(albumId, input);
  },

  // GET /api/v2/albums/[uuid]/add-photos?requestId= — the editor polls this after
  // submitting an add. 'completed' → re-fetch the album pages and inject; 'failed' →
  // surface the error (the hold was refunded); 'running' → keep polling.
  async getAddStatus(userId: string, albumId: string, requestId: string) {
    await albumService.findOwned(userId, albumId); // ownership gate (throws if not owned)
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job || job.albumId !== albumId || job.kind !== 'add') {
      return { status: 'unknown' as const };
    }
    if (job.status === 'COMPLETED') return { status: 'completed' as const };
    if (job.status === 'FAILED') {
      const err = (job.error as { message?: string } | null) ?? null;
      return { status: 'failed' as const, error: err?.message ?? null };
    }
    return { status: 'running' as const, stage: job.stage, progress: job.progress };
  },
};

// v2 init dispatch tail: forward to the agent, flip the job RUNNING. On submit
// failure, fail the job (kind=init → album FAILED + release) and still return the
// albumId without throwing (§6.5.3, don't orphan the failed card) — the album
// exists, so the browser must learn its id to store the recipe and open the
// retriable failed card. Throwing here would strand a FAILED album the user can
// never reach.
async function dispatchInitV2(
  albumId: string,
  input: V2InitInput,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  const photos: V2InitRequest['photos'] = input.photos.map((p) => ({
    photoId: p.photoId,
    base64: p.base64,
    width: p.width,
    height: p.height,
    ...(p.takenAt !== undefined ? { exif: { takenAt: p.takenAt } } : {}),
  }));

  try {
    await agentClient.submitInitV2({
      requestId: input.requestId,
      albumId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v2/internal/job-progress`,
      language: input.language,
      ...(input.promptHint ? { meta: { promptHint: input.promptHint } } : {}),
      photos,
    });
  } catch (e) {
    logger.error(
      { err: String(e), requestId: input.requestId },
      'agent v2 init submit failed, marking job FAILED',
    );
    await jobService.handleV2Failed(input.requestId, {
      code: 'AGENT_INTERNAL_ERROR',
      message: 'Failed to submit to agent',
    });
    return { albumId, requestId: input.requestId, accepted: true };
  }

  const job = await agentJobRepo.findByRequestId(input.requestId);
  if (job) await jobService.markRunning(db, job.id);

  return { albumId, requestId: input.requestId, accepted: true };
}

// v2 add-photos dispatch tail (mirrors dispatchInitV2). On submit failure, fail the
// job (kind=add → album stays EDITING, the add hold is refunded) and still return
// the requestId without throwing — the editor needs it to poll the add status.
async function dispatchAddPhotosV2(
  albumId: string,
  input: V2AddPhotosInput,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  const newPhotos: V2AddPhotosRequest['newPhotos'] = input.photos.map((p) => ({
    photoId: p.photoId,
    base64: p.base64,
    width: p.width,
    height: p.height,
    ...(p.takenAt !== undefined ? { exif: { takenAt: p.takenAt } } : {}),
  }));

  try {
    await agentClient.submitAddPhotosV2({
      requestId: input.requestId,
      albumId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v2/internal/job-progress`,
      language: input.language,
      ...(input.promptHint ? { meta: { promptHint: input.promptHint } } : {}),
      newPhotos,
    });
  } catch (e) {
    logger.error(
      { err: String(e), requestId: input.requestId },
      'agent v2 add-photos submit failed, marking job FAILED',
    );
    await jobService.handleV2Failed(input.requestId, {
      code: 'AGENT_INTERNAL_ERROR',
      message: 'Failed to submit to agent',
    });
    return { albumId, requestId: input.requestId, accepted: true };
  }

  const job = await agentJobRepo.findByRequestId(input.requestId);
  if (job) await jobService.markRunning(db, job.id);

  return { albumId, requestId: input.requestId, accepted: true };
}

// v2 finalize dispatch tail. On submit failure, fail the job (kind=finalize →
// album back to EDITING + hold kept), so the user can simply retry finalize. The
// draft is untouched; we never strand a charged-but-no-album state.
async function dispatchFinalizeV2(
  albumId: string,
  requestId: string,
  draftTree: AlbumDraft,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  try {
    await agentClient.submitFinalizeV2({
      requestId,
      albumId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v2/internal/job-progress`,
      draftTree,
    });
  } catch (e) {
    logger.error(
      { err: String(e), requestId },
      'agent v2 finalize submit failed, marking job FAILED',
    );
    await jobService.handleV2Failed(requestId, {
      code: 'AGENT_INTERNAL_ERROR',
      message: 'Failed to submit to agent',
    });
    return { albumId, requestId, accepted: true };
  }

  const job = await agentJobRepo.findByRequestId(requestId);
  if (job) await jobService.markRunning(db, job.id);

  return { albumId, requestId, accepted: true };
}
