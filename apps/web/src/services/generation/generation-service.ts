import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { logger } from '@/lib/log/logger';
import { albumService } from '@/services/album/album-service';
import { creditService } from '@/services/credit/credit-service';
import { jobService } from '@/services/job/job-service';
import type { V3AnalyzeRequest } from '@yujee/contracts';

type V3AnalyzeInput = {
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
  async submitAnalyzeV3(userId: string, input: V3AnalyzeInput) {
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
      await jobService.createGenerationJob(tx, {
        userId,
        albumId: album.albumId,
        requestId: input.requestId,
        kind: 'init',
      });
      await creditService.hold(tx, userId, amount, album.albumId);
      return album;
    });

    return dispatchAnalyzeV3(albumId, input);
  },

  async retryAnalyzeV3(userId: string, albumId: string, input: RetryInput) {
    const album = await albumService.findOwned(userId, albumId);
    const amount = creditService.cost(input.photos.length);
    await creditService.precheck(userId, amount);

    await db.transaction(async (tx) => {
      await albumService.setRetrying(tx, albumId);
      await jobService.createGenerationJob(tx, {
        userId,
        albumId,
        requestId: input.requestId,
        kind: 'init',
      });
      await creditService.hold(tx, userId, amount, albumId);
    });

    return dispatchAnalyzeV3(albumId, {
      requestId: input.requestId,
      language: input.language,
      photos: input.photos,
      ...(album.prompt ? { promptHint: album.prompt } : {}),
    });
  },
};

async function dispatchAnalyzeV3(
  albumId: string,
  input: V3AnalyzeInput,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  const photos: V3AnalyzeRequest['photos'] = input.photos.map((p) => ({
    photoId: p.photoId,
    base64: p.base64,
    width: p.width,
    height: p.height,
    ...(p.takenAt !== undefined ? { exif: { takenAt: p.takenAt } } : {}),
  }));

  try {
    await agentClient.submitAnalyzeV3({
      requestId: input.requestId,
      albumId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      ...(input.promptHint ? { meta: { promptHint: input.promptHint } } : {}),
      photos,
    });
  } catch (e) {
    logger.error(
      { err: String(e), requestId: input.requestId },
      'agent v3 analyze submit failed, marking job FAILED',
    );
    await jobService.handleV3Failed(input.requestId, {
      code: 'AGENT_INTERNAL_ERROR',
      message: 'Failed to submit to agent',
    });
    return { albumId, requestId: input.requestId, accepted: true };
  }

  const job = await agentJobRepo.findByRequestId(input.requestId);
  if (job) await jobService.markRunning(db, job.id);

  return { albumId, requestId: input.requestId, accepted: true };
}
