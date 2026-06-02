import { db } from '@/db/client';
import { albumService } from '@/services/album/album-service';
import { jobService } from '@/services/job/job-service';
import { creditService } from '@/services/credit/credit-service';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { logger } from '@/lib/log/logger';

type GenerationInput = {
  requestId: string;
  prompt: string;
  language: 'zh' | 'en';
  photos: AgentPhotoInput[];
};

type RetryInput = {
  requestId: string;
  language: 'zh' | 'en';
  photos: AgentPhotoInput[];
};

export const generationService = {
  async submit(userId: string, input: GenerationInput) {
    const amount = creditService.cost();
    await creditService.precheck(userId, amount);

    const placeholderTitle =
      input.prompt.trim().slice(0, 40) || (input.language === 'zh' ? '我的故事' : 'My Memoir');

    // Album + job + hold must commit together (invariant 8: credit reservation
    // and the work it reserves for share a transaction).
    const { albumId } = await db.transaction(async (tx) => {
      const album = await albumService.create(tx, {
        userId,
        prompt: input.prompt,
        photoCount: input.photos.length,
        title: placeholderTitle,
      });
      await jobService.create(tx, { userId, albumId: album.albumId, requestId: input.requestId });
      await creditService.hold(tx, userId, amount, album.albumId);
      return album;
    });

    return dispatch(albumId, {
      requestId: input.requestId,
      prompt: input.prompt,
      language: input.language,
      photos: input.photos,
    });
  },

  // Retry a FAILED album by reusing the SAME albumId (§6.5.3): no new album, the
  // failed card just reruns. The old hold was already released on failure, so we
  // run a fresh precheck + hold under a new requestId; the browser resends the
  // base64 (invariant 1 — originals never persisted server-side). prompt comes
  // from the stored album so the rerun stays faithful to the original story.
  async retry(userId: string, albumId: string, input: RetryInput) {
    const album = await albumService.findOwned(userId, albumId);
    const amount = creditService.cost();
    await creditService.precheck(userId, amount);

    // Claim FAILED → AGENT_RUNNING, create the new job, and hold credit together
    // (invariant 8). setRetrying throws ALBUM_NOT_RETRIABLE if the album isn't
    // FAILED (already running / lost a concurrent retry), rolling the tx back
    // before any hold is taken.
    await db.transaction(async (tx) => {
      await albumService.setRetrying(tx, albumId);
      await jobService.create(tx, { userId, albumId, requestId: input.requestId });
      await creditService.hold(tx, userId, amount, albumId);
    });

    return dispatch(albumId, {
      requestId: input.requestId,
      prompt: album.prompt,
      language: input.language,
      photos: input.photos,
    });
  },
};

// Shared tail of submit/retry (non-exported — it's an internal helper, not a
// public service method): fire the layout request at the Agent and flip the job
// QUEUED → RUNNING. On submit failure, fail the job — handleFailed marks the
// album FAILED and releases the hold — then return the albumId WITHOUT throwing
// (§6.5.3, don't orphan the failed card): the album already exists, so the
// browser must learn its id to store the recipe and open the retriable failed
// card. Throwing here would lose the albumId and strand a FAILED album the user
// can never reach.
async function dispatch(
  albumId: string,
  payload: { requestId: string; prompt: string; language: 'zh' | 'en'; photos: AgentPhotoInput[] },
): Promise<{ albumId: string; requestId: string }> {
  try {
    await agentClient.submitLayout({
      requestId: payload.requestId,
      prompt: payload.prompt,
      language: payload.language,
      callbackUrl: `${env.WEB_BASE_URL}/api/v1/internal/job-progress`,
      photos: payload.photos,
    });
  } catch (e) {
    logger.error({ err: String(e), requestId: payload.requestId }, 'agent submit failed, marking job FAILED');
    await jobService.handleFailed(payload.requestId, {
      code: 'AGENT_INTERNAL_ERROR',
      message: 'Failed to submit to agent',
    });
    return { albumId, requestId: payload.requestId };
  }

  const job = await agentJobRepo.findByRequestId(payload.requestId);
  if (job) await jobService.markRunning(db, job.id);

  return { albumId, requestId: payload.requestId };
}
