// 管理后台:更新日志列表(含草稿)+ 新建。
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { listAll, create, CHANGELOG_CATEGORIES } from '@/db/repos/changelog-repo';
import { ERRORS } from '@/lib/api/error-codes';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req.headers);
    const entries = await listAll();
    return ok({ entries });
  } catch (e) {
    return fromException(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req.headers);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw ERRORS.VALIDATION_FAILED('body required');
    const { category, titleZh, titleEn, bodyZh, bodyEn, imageUrl, isPublished } = body as {
      category?: string; titleZh?: string; titleEn?: string; bodyZh?: string; bodyEn?: string;
      imageUrl?: string | null; isPublished?: boolean;
    };
    if (!category || !CHANGELOG_CATEGORIES.includes(category as never)) {
      throw ERRORS.VALIDATION_FAILED(`category must be one of: ${CHANGELOG_CATEGORIES.join(', ')}`);
    }
    if (!titleZh || !titleEn || !bodyZh || !bodyEn) {
      throw ERRORS.VALIDATION_FAILED('titleZh/titleEn/bodyZh/bodyEn required');
    }
    const entry = await create({
      category, titleZh, titleEn, bodyZh, bodyEn,
      imageUrl: imageUrl ?? null,
      isPublished: Boolean(isPublished),
      createdBy: admin.id,
    });
    return ok({ entry });
  } catch (e) {
    return fromException(e);
  }
}
