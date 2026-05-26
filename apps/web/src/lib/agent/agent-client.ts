import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';

export type AgentPhotoInput = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
};

export type AgentLayoutRequest = {
  requestId: string;
  prompt: string;
  language: 'zh' | 'en';
  callbackUrl: string;
  photos: AgentPhotoInput[];
};

export const agentClient = {
  async submitLayout(payload: AgentLayoutRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v1/layout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },
};
