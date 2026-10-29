// 公开的更新日志页面:登录/未登录都可见,按日期倒序展示已发布条目。
// 打开页面时自动标记已读(登录用户),导航栏红点随之消失。
import { getAuthUser } from '@/lib/auth/require-auth';
import { listPublished, markSeen, CHANGELOG_CATEGORIES } from '@/db/repos/changelog-repo';
import { renderMarkdownSafe } from '@/lib/markdown/render';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

const CATEGORY_META: Record<string, { icon: string; labelZh: string; labelEn: string; color: string }> = {
  feature: { icon: '🆕', labelZh: '新功能', labelEn: 'New', color: 'text-green-600' },
  improvement: { icon: '🔧', labelZh: '优化', labelEn: 'Improved', color: 'text-blue-600' },
  notice: { icon: '💬', labelZh: '通知', labelEn: 'Notice', color: 'text-purple-600' },
  fix: { icon: '🐛', labelZh: '修复', labelEn: 'Fixed', color: 'text-orange-600' },
};

export default async function ChangelogPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const isZh = locale === 'zh';
  const t = getMessages(locale);

  // 已登录用户打开页面即标记已读(水位推进,红点消失)
  try {
    const user = await getAuthUser({ headers: new Headers() } as never).catch(() => null);
    if (user) await markSeen(user.id);
  } catch { /* 静默:标记失败不影响页面 */ }

  const entries = await listPublished(50);

  // 按日期分组
  const grouped = new Map<string, typeof entries>();
  for (const e of entries) {
    const dateKey = e.publishedAt.toISOString().slice(0, 10);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(e);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">
        {isZh ? '📋 更新日志' : '📋 Changelog'}
      </h1>
      {entries.length === 0 && (
        <p className="text-neutral-500">{isZh ? '暂无更新' : 'No updates yet'}</p>
      )}
      {[...grouped.entries()].map(([date, items]) => (
        <div key={date} className="mb-6">
          <div className="mb-3 border-b border-neutral-200 pb-1 text-sm font-medium text-neutral-400">
            {new Date(date + 'T00:00:00Z').toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </div>
          <div className="space-y-4">
            {items.map((entry) => {
              const meta = CATEGORY_META[entry.category] ?? CATEGORY_META.notice;
              const title = isZh ? entry.titleZh : entry.titleEn;
              const body = isZh ? entry.bodyZh : entry.bodyEn;
              return (
                <div key={entry.id} className="rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2">
                    <span>{meta.icon}</span>
                    <span className={`text-xs font-medium ${meta.color}`}>
                      {isZh ? meta.labelZh : meta.labelEn}
                    </span>
                  </div>
                  <h3 className="mt-1 font-semibold">{title}</h3>
                  <div
                    className="mt-1 text-sm text-neutral-600 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(body) ?? body }}
                  />
                  {entry.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.imageUrl}
                      alt={title}
                      className="mt-3 max-h-64 rounded-md object-cover"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
