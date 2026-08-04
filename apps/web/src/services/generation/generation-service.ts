import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { albums, users } from '@/db/schema';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { albumService } from '@/services/album/album-service';
import { loadStoryDraft } from '@/services/album/draft-store';
import { creditService } from '@/services/credit/credit-service';
import { jobService } from '@/services/job/job-service';
import { SelectLayoutRequest, V3LayoutTree } from '@yujee/contracts';
import type { V3AnalyzeRequest } from '@yujee/contracts';
import { ANON_MAX_ALBUMS, ANON_MAX_PHOTOS_PER_GENERATION } from '@/config/anon';

// 游客(匿名)口径:整条创作链零积分变动(不 precheck、不 hold —— 匿名余额被建号
// 钩子归零,真文案计费推迟到登录后 applyDesign 首跑);照片走 20 张小上限。
type GenerationOpts = { isAnonymous?: boolean };

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
  async submitAnalyzeV3(userId: string, input: V3AnalyzeInput, opts: GenerationOpts = {}) {
    const anon = opts.isAnonymous === true;
    if (anon && input.photos.length > ANON_MAX_PHOTOS_PER_GENERATION) {
      throw ERRORS.ANON_PHOTO_LIMIT();
    }
    const amount = creditService.cost(input.photos.length);
    if (!anon) await creditService.precheck(userId, amount);

    const placeholderTitle =
      input.promptHint?.trim().slice(0, 40) || (input.language === 'zh' ? '我的故事' : 'My Memoir');

    const { albumId } = await db.transaction(async (tx) => {
      if (anon) {
        // 锁 user 行序列化同一游客的并发创建(双击「发送」只建一本),再数相册。
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(albums)
          .where(eq(albums.userId, userId));
        if ((row?.count ?? 0) >= ANON_MAX_ALBUMS) throw ERRORS.ANON_ALBUM_LIMIT();
      }
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
      if (!anon) await creditService.hold(tx, userId, amount, album.albumId);
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
    opts: GenerationOpts = {},
  ) {
    const anon = opts.isAnonymous === true;
    const album = await albumService.findOwned(userId, albumId);
    if (album.status !== 'EDITING' || album.layoutJson != null) throw ERRORS.ALBUM_NOT_EDITABLE();
    // 游客上限按全书累计口径:已有 + 新增 ≤ 20,防止 1 本相册反复追加绕开小上限。
    if (anon && album.photoCount + input.photos.length > ANON_MAX_PHOTOS_PER_GENERATION) {
      throw ERRORS.ANON_PHOTO_LIMIT();
    }
    // draft_pages 拆表(Phase 1a)后 pages 不一定还活在 draftJson 里(见
    // handleV3SelectLayoutCompleted/handleV3ComposeCompleted,job-service.ts) ——
    // "已有排版页"闸门必须走 loadStoryDraft(行存在读行、无行才回退 legacy
    // draftJson.pages),不能再直接裸读 draftJson.pages。bake:false:这里只用
    // pages.length 判存在性,不碰 html,不需要现场烘。
    const draft = await loadStoryDraft(album, { bake: false });
    if (!draft || draft.pages.length === 0) {
      throw ERRORS.VALIDATION_FAILED('add-photos requires laid-out pages');
    }
    const amount = creditService.cost(input.photos.length);
    if (!anon) await creditService.precheck(userId, amount);
    try {
      await db.transaction(async (tx) => {
        await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId: input.requestId,
          kind: 'add',
        });
        if (!anon) await creditService.hold(tx, userId, amount, albumId);
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
    // draft_pages 拆表(Phase 1a):envelope(tree/progress)读点也统一经
    // loadStoryDraft(与 pages 闸门同一读层,唯一草稿存取层);无树(还没 analyze
    // 完)仍然抛,挡住误触发——只是从裸 zod parse 的 raw ZodError 换成
    // ERRORS.VALIDATION_FAILED,与本文件其余闸门错误同一口径。
    const loaded = await loadStoryDraft(album, { bake: false });
    if (!loaded) throw ERRORS.VALIDATION_FAILED('album has no story tree yet');
    const tree = loaded.tree;

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
