import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { SharedAlbum } from '@/components/album/SharedAlbum';
import type { EditorPage } from '@/components/album/types';

// 后台只读预览:从用户列表点「相册数」进来,看这个人(尤其是「做了书没注册」的游客)
// 到底做出了什么。与免登分享页 /s/[token] 用同一个 FlipBook 渲染,但数据不走冻结快照
// —— 快照要用户主动点过「保存」才有,游客基本没点过。详见 adminService.previewAlbum。
//
// 只读:这条路拿不到任何写能力。搜索引擎不收录。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminAlbumPreviewPage({
  params,
}: {
  params: Promise<{ locale: Locale; uuid: string }>;
}) {
  const { locale, uuid } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const preview = await adminService.previewAlbum(admin.id, uuid).catch(() => null);
  if (!preview) notFound();

  const t = getMessages(locale).admin.albumPreview;

  return (
    <main className="min-h-screen">
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-2 flex items-center justify-between gap-4">
        <div>
          <h1 className="serif text-2xl">{preview.title}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {t.readOnly} · {t.pageCount.replace('{count}', String(preview.pages.length))}
          </p>
          {preview.missingPhotoCount > 0 && (
            // 游客相册这里恒为「全缺」:album_photos 的唯一写入者挂 requireRealUser,
            // 游客零 R2 写入,原图只在他自己浏览器的 IndexedDB 里。说清楚,别让人
            // 以为是加载失败在那儿反复刷新。
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 max-w-2xl">
              {t.photosUnavailable
                .replace('{missing}', String(preview.missingPhotoCount))
                .replace('{total}', String(preview.referencedPhotoCount))}
            </p>
          )}
        </div>
        <Link
          href={`/${locale}/admin/users`}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-white hover:border-[var(--accent)] text-sm"
        >
          {t.back}
        </Link>
      </div>

      {preview.pages.length === 0 ? (
        // 半途而废的书也要能打开 —— 后台看的正是「他做到哪一步就走了」。
        <p className="max-w-5xl mx-auto px-6 py-16 text-[var(--muted)]">{t.empty}</p>
      ) : (
        <SharedAlbum
          pages={preview.pages as unknown as EditorPage[]}
          photoUrls={preview.photoUrls}
          boardBackground={preview.boardBackground}
          locale={locale}
          title={preview.title}
        />
      )}
    </main>
  );
}
