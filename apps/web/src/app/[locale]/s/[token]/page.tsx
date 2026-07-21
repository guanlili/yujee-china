import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { shareService } from '@/services/album/share-service';
import { SharedAlbum } from '@/components/album/SharedAlbum';
import type { EditorPage } from '@/components/album/types';

// 免登只读分享页。故意放在 /{locale}/s/[token](不在 middleware 的 protectedPaths 里,
// 不会 307 跳登录)。仅按 token 查冻结快照,不校验归属;查不到 → 404。搜索引擎不收录。
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// 服务端组件按 token 拉快照(公开,无鉴权),交给客户端 FlipBook 渲染。
export default async function SharePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { token } = await params;
  const share = await shareService.getPublicShare(token);
  if (!share) notFound();

  const { snapshot, title } = share;
  return (
    <SharedAlbum
      pages={snapshot.pages as EditorPage[]}
      photoUrls={snapshot.photoUrls}
      boardBackground={snapshot.boardBackground}
      locale={snapshot.locale}
      title={title}
    />
  );
}
