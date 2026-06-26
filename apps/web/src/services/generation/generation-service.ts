import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { albumService } from '@/services/album/album-service';
import { creditService } from '@/services/credit/credit-service';
import { jobService } from '@/services/job/job-service';
import { SelectLayoutRequest, V3LayoutTree } from '@yujee/contracts';
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
    // #232 opaque cluster label only — never a coordinate (see contract V3AnalyzePhoto).
    clusterId?: string | null;
  }>;
};

type RetryInput = {
  requestId: string;
  language: 'zh' | 'en';
  photos: AgentPhotoInput[];
};

type SelectLayoutInput = {
  requestId: string;
  language: 'zh' | 'en';
  refs: Record<string, string> | Array<{ photoId: string; ref200px: string }>;
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

  async submitSelectLayoutV3(userId: string, albumId: string, input: SelectLayoutInput) {
    const album = await albumService.findOwned(userId, albumId);
    const job = await agentJobRepo.findByRequestId(input.requestId);
    if (!job) throw ERRORS.JOB_NOT_FOUND();
    if (job.userId !== userId || job.albumId !== albumId) throw ERRORS.JOB_NOT_OWNED();
    if (album.status !== 'AGENT_RUNNING' || job.status !== 'RUNNING' || job.stage !== 'layout') {
      throw ERRORS.ALBUM_NOT_EDITABLE();
    }

    const tree = readDraftTree(album.draftJson);
    const payload = buildSelectLayoutRequestFromTree({
      requestId: input.requestId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      tree,
      refs: input.refs,
    });
    if (job.progress !== 50) {
      return { albumId, requestId: input.requestId, accepted: true };
    }
    const reserved = await agentJobRepo.reserveSelectLayout(db, job.id);
    if (!reserved) {
      return { albumId, requestId: input.requestId, accepted: true };
    }

    try {
      await agentClient.submitSelectLayoutV3(payload);
    } catch (e) {
      logger.error(
        { err: String(e), requestId: input.requestId },
        'agent v3 select-layout submit failed, marking job FAILED',
      );
      await jobService.handleV3Failed(input.requestId, {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'Failed to submit select-layout to agent',
      });
      return { albumId, requestId: input.requestId, accepted: true };
    }

    return { albumId, requestId: input.requestId, accepted: true };
  },
};

function toRefMap(refs: SelectLayoutInput['refs']): Map<string, string> {
  if (Array.isArray(refs)) return new Map(refs.map((item) => [item.photoId, item.ref200px]));
  return new Map(Object.entries(refs));
}

function readDraftTree(draftJson: unknown) {
  if (
    draftJson &&
    typeof draftJson === 'object' &&
    !Array.isArray(draftJson) &&
    (draftJson as { version?: unknown }).version === 'v3-story'
  ) {
    return V3LayoutTree.parse((draftJson as { tree?: unknown }).tree);
  }
  return V3LayoutTree.parse(draftJson);
}

export function buildSelectLayoutRequestFromTree(input: {
  requestId: string;
  callbackUrl: string;
  language: 'zh' | 'en';
  tree: unknown;
  refs: SelectLayoutInput['refs'];
}): SelectLayoutRequest {
  const tree = V3LayoutTree.parse(input.tree);
  const refs = toRefMap(input.refs);
  const payload = {
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    language: input.language,
    chapters: tree.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      ...(chapter.description ? { structureHint: chapter.description } : {}),
      photos: chapter.photos.map((photo) => {
        const ref200px = refs.get(photo.photoId);
        if (!ref200px) {
          throw ERRORS.VALIDATION_FAILED(`missing 200px ref for photo ${photo.photoId}`);
        }
        return {
          photoId: photo.photoId,
          ref200px,
          orientation: photo.orientation,
          takenAt: photo.takenAt ?? null,
        };
      }),
    })),
  };
  const parsed = SelectLayoutRequest.safeParse(payload);
  if (!parsed.success) {
    throw ERRORS.VALIDATION_FAILED(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}

async function dispatchAnalyzeV3(
  albumId: string,
  input: V3AnalyzeInput,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  const photos: V3AnalyzeRequest['photos'] = input.photos.map((p) => ({
    photoId: p.photoId,
    base64: p.base64,
    width: p.width,
    height: p.height,
    // #232: forward the opaque cluster label when present (null/absent → omitted →
    // Agent degrades to "one big batch"). NEVER any coordinate — only this label.
    ...(p.clusterId != null ? { clusterId: p.clusterId } : {}),
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
