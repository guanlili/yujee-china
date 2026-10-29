// 透传中转站可用模型列表(管理后台「模型设置」页的选择器用)。
// 中转站 /api/v1/models 无需鉴权,这里只做 admin 权限闸 + 缓存 5 分钟。
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';

const CACHE_TTL = 5 * 60 * 1000;
let cache: { at: number; data: Array<{ model: string; input_price?: string; output_price?: string }> } | null = null;

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req.headers);
    if (cache && Date.now() - cache.at < CACHE_TTL) {
      return ok({ models: cache.data, cached: true });
    }
    const res = await fetch('https://kexiangai.com/api/v1/models', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`relay models HTTP ${res.status}`);
    const json = (await res.json()) as { list?: Array<{ model: string; input_price?: string; output_price?: string }> };
    const models = (json.list ?? []).map((m) => ({ model: m.model, input_price: m.input_price, output_price: m.output_price }));
    cache = { at: Date.now(), data: models };
    return ok({ models, cached: false });
  } catch (e) {
    return fromException(e);
  }
}
