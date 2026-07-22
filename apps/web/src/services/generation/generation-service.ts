import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { albumService } from '@/services/album/album-service';
import { creditService } from '@/services/credit/credit-service';
import { jobService } from '@/services/job/job-service';
import { SelectLayoutRequest, V3LayoutTree, V3StoryDraft } from '@yujee/contracts';
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
  // 追加照片(加图增量重跑):只排这些章节;完成回调按 job.meta.appendChapterIds 走
  // 「插入合并」。省略 = 全书排版(替换 draft.pages)。
  chapterIds?: string[];
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

  // 追加照片(加图增量重跑 spec §1):只把新照片发给 analyze;kind='add' 独立 job;
  // 积分按新增张数 hold,analyze 完成即 settle(照搬首次生成口径,job-service append 分支)。
  // (album,kind) 活跃唯一索引兜底防并发追加;书里必须已有排版页(排版完成后才可加图)。
  async submitAddPhotosV3(
    userId: string,
    albumId: string,
    input: { requestId: string; language: 'zh' | 'en'; photos: V3AnalyzeInput['photos'] },
  ) {
    const album = await albumService.findOwned(userId, albumId);
    if (album.status !== 'EDITING' || album.layoutJson != null) throw ERRORS.ALBUM_NOT_EDITABLE();
    const draft = V3StoryDraft.safeParse(album.draftJson);
    if (!draft.success || !draft.data.pages || draft.data.pages.length === 0) {
      throw ERRORS.VALIDATION_FAILED('add-photos requires laid-out pages');
    }
    const amount = creditService.cost(input.photos.length);
    await creditService.precheck(userId, amount);
    try {
      await db.transaction(async (tx) => {
        await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId: input.requestId,
          kind: 'add',
        });
        await creditService.hold(tx, userId, amount, albumId);
      });
    } catch {
      // (album,'add') 活跃唯一索引撞上 = 已有在途追加;按不可编辑返回,前端提示稍后再试。
      throw ERRORS.ALBUM_NOT_EDITABLE();
    }
    return dispatchAnalyzeV3(albumId, {
      requestId: input.requestId,
      language: input.language,
      photos: input.photos,
    });
  },

  async submitSelectLayoutV3(userId: string, albumId: string, input: SelectLayoutInput) {
    const album = await albumService.findOwned(userId, albumId);
    // 解耦:排版是独立操作,不再依赖 analyze 的 init job(analyze 完它已 COMPLETED)。闸门改看
    // 相册态 + 草稿树:必须 EDITING、还没定稿(layoutJson==null),且草稿里有可排版的章节树。
    if (album.status !== 'EDITING' || album.layoutJson != null) {
      throw ERRORS.ALBUM_NOT_EDITABLE();
    }
    const tree = readDraftTree(album.draftJson); // 无树(还没 analyze 完)会抛,挡住误触发

    // 排版另起独立 layout job:自己的 requestId、kind='layout'、不碰积分。
    const layoutRequestId = crypto.randomUUID();
    // 先构造载荷(校验 refs)—— 坏 refs 在建 job 前就抛,不留孤儿 layout job。
    const payload = buildSelectLayoutRequestFromTree({
      requestId: layoutRequestId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      tree,
      refs: input.refs,
      ...(input.chapterIds ? { chapterIds: input.chapterIds } : {}),
    });

    // unique(album, layout, QUEUED/RUNNING) 防重复触发 —— 已有在跑的排版就幂等接受、不起第二个。
    try {
      await db.transaction(async (tx) => {
        const created = await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId: layoutRequestId,
          kind: 'layout',
          ...(input.chapterIds ? { meta: { appendChapterIds: input.chapterIds } } : {}),
        });
        await jobService.markRunning(tx, created.id);
      });
    } catch {
      return { albumId, requestId: input.requestId, accepted: true };
    }

    try {
      await agentClient.submitSelectLayoutV3(payload);
    } catch (e) {
      logger.error(
        { err: String(e), requestId: layoutRequestId },
        'agent v3 select-layout submit failed, marking layout job FAILED',
      );
      await jobService.handleV3Failed(layoutRequestId, {
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
  // 追加照片:只装这些章节(refs 也只需覆盖它们的照片)。省略 = 全书。
  chapterIds?: string[];
}): SelectLayoutRequest {
  const tree = V3LayoutTree.parse(input.tree);
  const refs = toRefMap(input.refs);
  const scope = input.chapterIds ? new Set(input.chapterIds) : null;
  const chapters = scope ? tree.chapters.filter((c) => scope.has(c.chapterId)) : tree.chapters;
  if (scope && chapters.length !== scope.size) {
    throw ERRORS.VALIDATION_FAILED('unknown chapterId in select-layout scope');
  }
  const payload = {
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    language: input.language,
    chapters: chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      // 结构提示只认 description(写目录环节才填,分析期为空)。章标识在 title 上,
      // 那是拍摄日期派生的展示名,不是给排版的语义线索,别往这里塞。
      ...(chapter.description ? { structureHint: chapter.description } : {}),
      // 采访结果:喂给排版选版式(选贴合基调的版式),写文案在其后的 /v3/compose。之前漏传,导致
      // chapterContext 契约字段有但从不生效 —— 这里补上。跳过采访/老树 => ""。
      chapterContext: chapter.chapterContext ?? '',
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
          // 构图:排版按朝向×构图匹配槽位。豆包识图已砍,照片的文字描述不再下发
          // (compose 环节让模型直接看真实照片写文案)。
          ...(photo.composition != null ? { composition: photo.composition } : {}),
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
