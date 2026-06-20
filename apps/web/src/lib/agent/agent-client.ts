import { env } from '@/lib/env';
import { ERRORS, mapAgentErrorCode } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import {
  V3ApplyThemeResponse,
  V3ChapterChatResponse,
  V3CoverResponse,
  V3FinalizeResponse,
  V3RecommendResponse,
} from '@yujee/contracts';
import type {
  V3AnalyzeRequest,
  V3ApplyThemeRequest,
  V3ChapterChatRequest,
  V3CoverRequest,
  V3FinalizeRequest,
  V3RecommendRequest,
} from '@yujee/contracts';

export type AgentPhotoInput = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
  takenAt?: string | null;
  // #232 opaque spatio-temporal cluster label (c1/c2/…); never a coordinate.
  clusterId?: string | null;
};

export const agentClient = {
  async submitAnalyzeV3(payload: V3AnalyzeRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v3/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v3 analyze submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected analyze payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v3 analyze non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  async chapterChatV3(payload: V3ChapterChatRequest): Promise<V3ChapterChatResponse> {
    return postSyncV3('/v3/chapter-chat', payload, V3ChapterChatResponse, {
      albumId: payload.albumId,
    });
  },

  async recommendV3(payload: V3RecommendRequest): Promise<V3RecommendResponse> {
    const data = await postSyncV3('/v3/recommend', payload, V3RecommendResponse, {
      albumId: payload.albumId,
    });
    assertRecommendChapterCoverage(payload, data);
    return data;
  },

  async applyThemeV3(payload: V3ApplyThemeRequest): Promise<V3ApplyThemeResponse> {
    return postSyncV3('/v3/apply-theme', payload, V3ApplyThemeResponse, {
      albumId: payload.albumId,
    });
  },

  async coverV3(payload: V3CoverRequest): Promise<V3CoverResponse> {
    return postSyncV3('/v3/cover', payload, V3CoverResponse, {
      albumId: payload.albumId,
    });
  },

  async finalizeV3(payload: V3FinalizeRequest): Promise<V3FinalizeResponse> {
    return postSyncV3Finalize('/v3/finalize', payload, V3FinalizeResponse, {
      albumId: payload.albumId,
    });
  },
};

async function postSyncV3<T>(
  path: string,
  payload: unknown,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  logCtx: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.AGENT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    logger.error({ err: String(e), api: 'v3', path, ...logCtx }, 'agent sync call failed');
    throw ERRORS.AGENT_CHAT_FAILED();
  }
  if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
  if (!res.ok) {
    logger.error({ status: res.status, api: 'v3', path, ...logCtx }, 'agent sync non-2xx');
    if (res.status === 422) {
      const code = await readAgentErrorCode(res);
      if (code && mapAgentErrorCode(code) === 'AGENT_INVALID_OUTPUT') {
        throw ERRORS.AGENT_INVALID_OUTPUT();
      }
      throw ERRORS.VALIDATION_FAILED('agent rejected sync payload');
    }
    throw ERRORS.AGENT_CHAT_FAILED();
  }
  const json = await res.json();
  if (!json.ok) throw ERRORS.AGENT_CHAT_FAILED();
  const parsed = schema.safeParse(json.data);
  if (!parsed.success) {
    logger.error({ api: 'v3', path, ...logCtx }, 'agent sync response off-contract');
    throw ERRORS.AGENT_INVALID_OUTPUT();
  }
  return parsed.data;
}

async function postSyncV3Finalize<T>(
  path: string,
  payload: unknown,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  logCtx: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.AGENT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    logger.error({ err: String(e), api: 'v3', path, ...logCtx }, 'agent sync call failed');
    throw ERRORS.AGENT_INTERNAL_ERROR();
  }
  if (!res.ok) {
    logger.error({ status: res.status, api: 'v3', path, ...logCtx }, 'agent sync non-2xx');
    if (res.status === 422) {
      const code = await readAgentErrorCode(res);
      if (code && mapAgentErrorCode(code) === 'AGENT_INVALID_OUTPUT') {
        throw ERRORS.AGENT_INVALID_OUTPUT();
      }
      throw ERRORS.VALIDATION_FAILED('agent rejected sync payload');
    }
    throw ERRORS.AGENT_INTERNAL_ERROR();
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    logger.error({ err: String(e), api: 'v3', path, ...logCtx }, 'agent sync response JSON parse failed');
    throw ERRORS.AGENT_INTERNAL_ERROR();
  }
  if (!json || typeof json !== 'object' || Array.isArray(json) || !(json as { ok?: boolean }).ok) {
    logger.error({ api: 'v3', path, ...logCtx }, 'agent sync non-ok envelope');
    throw ERRORS.AGENT_INTERNAL_ERROR();
  }
  const parsed = schema.safeParse((json as { data?: unknown }).data);
  if (!parsed.success) {
    logger.error({ api: 'v3', path, ...logCtx }, 'agent sync response off-contract');
    throw ERRORS.AGENT_INVALID_OUTPUT();
  }
  return parsed.data;
}

async function readAgentErrorCode(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as {
      detail?: { error?: { code?: unknown } };
      error?: { code?: unknown };
    };
    const code = body.detail?.error?.code ?? body.error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

function assertRecommendChapterCoverage(
  payload: V3RecommendRequest,
  response: V3RecommendResponse,
): void {
  const expected = payload.chapters.map((chapter) => chapter.chapterId);
  const seen = new Set<string>();
  for (const rec of response.chapterColors) {
    if (seen.has(rec.chapterId)) {
      logger.error({ albumId: payload.albumId, chapterId: rec.chapterId }, 'agent v3 recommend duplicate chapter color');
      throw ERRORS.AGENT_INVALID_OUTPUT();
    }
    seen.add(rec.chapterId);
  }
  if (response.chapterColors.length !== expected.length || expected.some((chapterId) => !seen.has(chapterId))) {
    logger.error(
      { albumId: payload.albumId, expectedChapterIds: expected, returnedChapterIds: [...seen] },
      'agent v3 recommend chapter color coverage mismatch',
    );
    throw ERRORS.AGENT_INVALID_OUTPUT();
  }
}
