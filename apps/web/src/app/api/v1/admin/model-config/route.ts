// 管理后台「模型设置」:读/写三条链路的模型名覆盖值。
// 安全红线:只管模型名;API key / base URL 留在服务器 env,不进这个接口。
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { env } from '@/lib/env';
import {
  MODEL_CONFIG_KEYS,
  getAllModelOverrides,
  setModelOverride,
  type ModelConfigKey,
} from '@/db/repos/model-config-repo';
import { ERRORS } from '@/lib/api/error-codes';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req.headers);
    const overrides = await getAllModelOverrides();

    // env 默认值(各链路当前配置的"底座")
    const defaults: Record<string, string> = {
      compose_model: process.env.COMPOSE_ARK_MODEL ?? 'doubao-seed-2-1-turbo-260628',
      design_model: process.env.DESIGN_AGENT_MODEL ?? 'kimi-k2.6',
      image_model: process.env.ARK_IMAGE_MODEL ?? 'doubao-seedream-4-0-250828',
    };

    // 生效值 = DB 覆盖 > env 默认
    const effective: Record<string, string> = {};
    for (const key of MODEL_CONFIG_KEYS) {
      effective[key] = overrides[key] ?? defaults[key] ?? '';
    }

    return ok({ defaults, overrides, effective });
  } catch (e) {
    return fromException(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req.headers);
    const body = (await req.json().catch(() => null)) as { key?: string; value?: string | null } | null;
    if (!body?.key || !MODEL_CONFIG_KEYS.includes(body.key as ModelConfigKey)) {
      throw ERRORS.VALIDATION_FAILED(`key must be one of: ${MODEL_CONFIG_KEYS.join(', ')}`);
    }
    if (body.value !== null && (typeof body.value !== 'string' || body.value.length === 0 || body.value.length > 200)) {
      throw ERRORS.VALIDATION_FAILED('value must be a non-empty string ≤200 chars, or null to reset');
    }
    await setModelOverride(body.key as ModelConfigKey, body.value ?? null, admin.id);
    return ok({ key: body.key, value: body.value });
  } catch (e) {
    return fromException(e);
  }
}
