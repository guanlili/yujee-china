import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/auth/better-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { analyticsRepo } from '@/db/repos/analytics-repo';
import type { NewAnalyticsEvent } from '@/db/schema';
import {
  ANALYTICS_MAX_BATCH,
  ANALYTICS_META_VALUE_MAX,
  ANALYTICS_RESULTS,
  isAnalyticsEventName,
  isAnalyticsMetaKey,
  sanitizeAnalyticsMessage,
  type AnalyticsMeta,
} from '@/lib/analytics/events';

// 埋点上报。设计取舍写在下面,因为这张表迟早会被问「为什么这么做」。
//
// ① 匿名也接受:首页访客没有账号,但他们恰恰是最需要被量到的那群人。匿名身份
//    放在 cookie(yj_aid)里,只有随机 UUID,关联不到任何个人信息。
// ② 有登录态时以登录身份为准:同一个人换设备也能串起来;cookie 只在无会话时用。
// ③ 永不因为埋点报错影响调用方:非法事件名/非法 meta 键直接丢弃并照常返回 200,
//    只把「全批都不合法」当 400。埋点是旁路,不是业务。
// ④ 隐私在写入侧拦截,不指望前端自觉:meta 只认白名单键、值强制截断,错误消息
//    过一遍脱敏(去 query、替换邮箱与长数字)。
// ⑤ 限流用进程内计数:本项目单容器部署,够用;真要多实例再换共享存储。

const EventSchema = z.object({
  name: z.string().max(40),
  albumId: z.string().max(64).optional(),
  value: z.number().finite().optional(),
  result: z.enum(ANALYTICS_RESULTS).optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const BodySchema = z.object({
  events: z.array(EventSchema).max(ANALYTICS_MAX_BATCH),
});

const ANON_COOKIE = 'yj_aid';
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// 简单窗口限流:同一来源每 60 秒最多 300 条(正常用户远达不到)。
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_EVENTS = 300;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function takeFromBucket(key: string, cost: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: cost, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count + cost > RATE_MAX_EVENTS) return false;
  bucket.count += cost;
  return true;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function sanitizeMeta(raw: Record<string, string | number | boolean> | undefined): AnalyticsMeta | undefined {
  if (!raw) return undefined;
  const out: AnalyticsMeta = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isAnalyticsMetaKey(key)) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    const text = key === 'message' ? sanitizeAnalyticsMessage(value) : value.slice(0, ANALYTICS_META_VALUE_MAX);
    if (text.length > 0) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(BodySchema, req);
    const ip = clientIp(req);

    if (!takeFromBucket(ip, body.events.length)) {
      // 超限不写库,但仍返回 200:让调用方安心丢弃,不要为了埋点重试。
      return ok({ accepted: 0, dropped: body.events.length, reason: 'rate_limited' });
    }

    const session = await getAuth().api.getSession({ headers: req.headers });
    const userId = session?.user?.id ?? null;
    const cookieAid = req.cookies.get(ANON_COOKIE)?.value ?? null;

    // 立即生成一个匿名 id 并发回:第一屏都能归到同一个人身上,不用等下次请求。
    const anonId = cookieAid ?? crypto.randomUUID();
    const subjectType = userId ? 'user' : 'anon';
    const subjectId = userId ?? anonId;

    // 合法的留下,非法的静默丢弃(事件名拼错不该让调用方 500)
    const rows: NewAnalyticsEvent[] = [];
    for (const event of body.events) {
      if (!isAnalyticsEventName(event.name)) continue;
      rows.push({
        name: event.name,
        subjectType,
        subjectId,
        albumId: event.albumId ?? null,
        locale: typeof event.meta?.locale === 'string' ? event.meta.locale.slice(0, 8) : null,
        value: event.value === undefined ? null : Math.trunc(event.value),
        result: event.result ?? null,
        meta: sanitizeMeta(event.meta) ?? null,
      });
    }

    if (rows.length === 0) {
      return ok({ accepted: 0, dropped: body.events.length });
    }

    await analyticsRepo.insertMany(rows);

    const response = NextResponse.json({
      ok: true,
      data: { accepted: rows.length, dropped: body.events.length - rows.length },
    });
    if (!cookieAid) {
      // 匿名关联 id:只有随机 UUID,关联不到任何个人信息;HttpOnly 避免被页面脚本读取
      response.cookies.set(ANON_COOKIE, anonId, {
        path: '/',
        maxAge: ANON_COOKIE_MAX_AGE,
        sameSite: 'lax',
        httpOnly: true,
      });
    }
    return response;
  } catch (e) {
    return fromException(e);
  }
}
