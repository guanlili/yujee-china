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

export const generationService = {
  async submit(userId: string, input: GenerationInput) {
    await creditService.precheck(userId);

    const placeholderTitle =
      input.prompt.trim().slice(0, 40) || (input.language === 'zh' ? '我的故事' : 'My Memoir');

    const { albumId } = await albumService.create(db, {
      userId,
      prompt: input.prompt,
      photoCount: input.photos.length,
      title: placeholderTitle,
    });
    await jobService.create(db, { userId, albumId, requestId: input.requestId });
    await creditService.hold(db, userId, albumId);

    try {
      await agentClient.submitLayout({
        requestId: input.requestId,
        prompt: input.prompt,
        language: input.language,
        callbackUrl: `${env.WEB_BASE_URL}/api/v1/internal/job-progress`,
        photos: input.photos,
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: input.requestId }, 'agent submit failed, marking job FAILED');
      await jobService.handleFailed(input.requestId, {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'Failed to submit to agent',
      });
      throw e;
    }

    const job = await agentJobRepo.findByRequestId(input.requestId);
    if (job) await jobService.markRunning(db, job.id);

    return { albumId, requestId: input.requestId };
  },
};
