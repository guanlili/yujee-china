import { env } from '@/lib/env';
import { ERRORS, mapAgentErrorCode } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { V3DesignData, V3DesignRequest } from '@yujee/contracts';
import type { SelectLayoutRequest, V3AnalyzeRequest } from '@yujee/contracts';

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

  async submitSelectLayoutV3(payload: SelectLayoutRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v3/select-layout`, {
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
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v3 select-layout submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected select-layout payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v3 select-layout non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  // 设计环节(同步):字体/颜色/封面封尾文案决策。应用在 Web 侧。
  async designV3(albumId: string, payload: V3DesignRequest): Promise<V3DesignData> {
    return postSyncV3('/v3/design', payload, V3DesignData, { albumId });
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

