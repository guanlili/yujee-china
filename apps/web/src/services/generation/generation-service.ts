import { db } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { agentClient, type AgentPhotoInput } from '@/lib/agent/agent-client';
import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { albumService } from '@/services/album/album-service';
import { creditService } from '@/services/credit/credit-service';
import { jobService } from '@/services/job/job-service';
import { transientLayoutCandidates } from '@/services/album/layout-candidates';
import { JudgeLayoutRequest, SelectLayoutRequest, V3LayoutTree } from '@yujee/contracts';
import type {
  JudgeLayoutUnit,
  SelectLayoutCandidateUnit,
  V3AnalyzeRequest,
} from '@yujee/contracts';

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

// P2 phase 2 (docs/agent/contract.md §5.2.1): the browser sends one entry per
// candidate unit. Each carries the unit's candidates with the browser-rendered
// thumbnail attached (omitted/empty → Agent falls back to candidate 0). Single-
// candidate units carry chosenIndex=0 and skip rendering.
// 浏览器传的 unit:只有 candidates + 缩略图,不带写文素材(photos/chapterContext)——
// 那些由 Web 从 draft 补进 buildJudgeLayoutRequest。so 浏览器侧类型去掉这两个。
type BrowserJudgeUnit = Omit<JudgeLayoutUnit, 'photos' | 'chapterContext'>;

type JudgeLayoutInput = {
  requestId: string;
  language: 'zh' | 'en';
  units: BrowserJudgeUnit[];
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
    });

    // unique(album, layout, QUEUED/RUNNING) 防重复触发 —— 已有在跑的排版就幂等接受、不起第二个。
    try {
      await db.transaction(async (tx) => {
        const created = await jobService.createGenerationJob(tx, {
          userId,
          albumId,
          requestId: layoutRequestId,
          kind: 'layout',
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

  // P2 phase 2 read (docs/agent/contract.md §5.2.1): hand the browser the candidate
  // STRUCTURES (templateId + slot→photoId) the `candidates` callback stashed, so the
  // browser can render a thumbnail per candidate. Ownership + job-state checked; the
  // candidates are transient (in-memory), so a miss (different instance / evicted)
  // returns ready=false and the browser takes the documented "candidate 0" fallback.
  async getJudgeCandidates(
    userId: string,
    albumId: string,
    requestId: string,
  ): Promise<{ ready: boolean; units: SelectLayoutCandidateUnit[] }> {
    const album = await albumService.findOwned(userId, albumId);
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) throw ERRORS.JOB_NOT_FOUND();
    if (job.userId !== userId || job.albumId !== albumId) throw ERRORS.JOB_NOT_OWNED();
    // 时序反转:排版期 album 恒为 EDITING(P2 缩略图轮询也在 EDITING 下发生)。放宽以取回候选。
    if (!(album.status === 'EDITING' || album.status === 'AGENT_RUNNING'))
      throw ERRORS.ALBUM_NOT_EDITABLE();
    const units = transientLayoutCandidates.get(requestId);
    if (!units) return { ready: false, units: [] };
    return { ready: true, units };
  },

  // P2 phase 2 dispatch (docs/agent/contract.md §5.2.1): the browser POSTs the
  // candidates with rendered thumbnails attached. We CAS the job 52→53 (single
  // dispatch) and forward to Agent /v3/judge-layout, which runs the Gemini judge and
  // returns final pages through the SAME select-layout `completed` callback. No credit
  // is reserved here — phase 1's select-layout already holds it (kept single).
  async submitJudgeLayoutV3(userId: string, albumId: string, input: JudgeLayoutInput) {
    const album = await albumService.findOwned(userId, albumId);
    const job = await agentJobRepo.findByRequestId(input.requestId);
    if (!job) throw ERRORS.JOB_NOT_FOUND();
    if (job.userId !== userId || job.albumId !== albumId) throw ERRORS.JOB_NOT_OWNED();
    // 时序反转:收集完才排版,此刻 album 恒为 EDITING(不再翻 AGENT_RUNNING);AGENT_RUNNING
    // 保留以兼容老时序/回退开关。真正的并发闸是下面的 progress 哨兵 + reserve*() CAS,不靠 status。
    if (
      !(album.status === 'EDITING' || album.status === 'AGENT_RUNNING') ||
      job.status !== 'RUNNING' ||
      job.stage !== 'layout'
    ) {
      throw ERRORS.ALBUM_NOT_EDITABLE();
    }
    // Not yet at the candidates-ready sentinel (or phase 2 already dispatched / done):
    // idempotently accept so a retrying browser doesn't error.
    if (job.progress !== 52) {
      return { albumId, requestId: input.requestId, accepted: true };
    }

    const payload = buildJudgeLayoutRequest({
      requestId: input.requestId,
      callbackUrl: `${env.WEB_BASE_URL}/api/v3/internal/job-progress`,
      language: input.language,
      units: input.units,
      tree: album.draftJson, // 从 draft 补写文素材(sceneDescription + chapterContext)进 judge 请求
    });

    const reserved = await agentJobRepo.reserveJudgeLayout(db, job.id);
    if (!reserved) {
      return { albumId, requestId: input.requestId, accepted: true };
    }

    try {
      await agentClient.submitJudgeLayoutV3(payload);
    } catch (e) {
      logger.error(
        { err: String(e), requestId: input.requestId },
        'agent v3 judge-layout submit failed, marking job FAILED',
      );
      await jobService.handleV3Failed(input.requestId, {
        code: 'AGENT_INTERNAL_ERROR',
        message: 'Failed to submit judge-layout to agent',
      });
      return { albumId, requestId: input.requestId, accepted: true };
    }

    // Candidates served their purpose; drop the transient stash.
    transientLayoutCandidates.clear(input.requestId);
    return { albumId, requestId: input.requestId, accepted: true };
  },
};

export function buildJudgeLayoutRequest(input: {
  requestId: string;
  callbackUrl: string;
  language: 'zh' | 'en';
  units: BrowserJudgeUnit[];
  tree?: unknown; // draft tree:按 chapterId 给每个 unit 补写文素材(评委选完当场写文案)。
}): JudgeLayoutRequest {
  // 从 draft tree 建 chapterId → {photos(sceneDescription), chapterContext} 索引。
  // 浏览器传的 units 只有 candidates/缩略图,不持 tree —— 写文素材由 Web 从 draft 补(§3 数据归属)。
  const byChapter = new Map<string, { photos: { photoId: string; sceneDescription: string }[]; chapterContext: string }>();
  if (input.tree !== undefined) {
    const tree = readDraftTree(input.tree);
    for (const chapter of tree.chapters) {
      byChapter.set(chapter.chapterId, {
        chapterContext: chapter.chapterContext ?? '',
        photos: chapter.photos.map((p) => ({ photoId: p.photoId, sceneDescription: p.sceneDescription ?? '' })),
      });
    }
  }
  const units = input.units.map((unit) => {
    const extra = byChapter.get(unit.chapterId);
    return extra ? { ...unit, photos: extra.photos, chapterContext: extra.chapterContext } : unit;
  });
  const payload = {
    requestId: input.requestId,
    callbackUrl: input.callbackUrl,
    language: input.language,
    units,
  };
  const parsed = JudgeLayoutRequest.safeParse(payload);
  if (!parsed.success) {
    throw ERRORS.VALIDATION_FAILED(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}

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
      // 采访结果:喂给排版评委(选贴合基调的版式)+ 排版后一次性写文案。之前漏传,导致
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
          // 构图 + 场景:排版按朝向×构图匹配槽;写文案 AI 据 sceneDescription grounding。
          ...(photo.composition != null ? { composition: photo.composition } : {}),
          sceneDescription: photo.sceneDescription ?? '',
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
