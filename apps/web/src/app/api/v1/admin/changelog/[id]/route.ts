// 管理后台:单条更新/删除。
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { update, remove } from '@/db/repos/changelog-repo';
import { ERRORS } from '@/lib/api/error-codes';

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req.headers);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw ERRORS.VALIDATION_FAILED('body required');
    const allowed = ['category', 'titleZh', 'titleEn', 'bodyZh', 'bodyEn', 'imageUrl', 'isPublished', 'publishedAt'];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }
    await update(id, patch);
    return ok({ updated: true });
  } catch (e) {
    return fromException(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req.headers);
    const { id } = await ctx.params;
    await remove(id);
    return ok({ deleted: true });
  } catch (e) {
    return fromException(e);
  }
}
