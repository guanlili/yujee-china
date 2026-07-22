import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import type { ComposeRequest, SelectLayoutRequest, V3AnalyzeRequest } from '@yujee/contracts';

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

  // ④ 一次性成稿(异步 202 + callback):按章并发让 Gemini 看真实照片 + 读用户讲的故事
  // 写满全书文案,并出封面/封尾文案与字体。耗时几十秒起,故走 job + 回调,不再同步等。
  async submitComposeV3(payload: ComposeRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v3/compose`, {
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
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v3 compose submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected compose payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v3 compose non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },
};
