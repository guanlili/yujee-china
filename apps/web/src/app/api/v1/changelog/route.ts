// 公开:已发布条目按日期倒序。无需登录。
import { NextRequest } from 'next/server';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { listPublished } from '@/db/repos/changelog-repo';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);
    const entries = await listPublished(limit, offset);
    return ok({ entries });
  } catch (e) {
    return fromException(e);
  }
}
