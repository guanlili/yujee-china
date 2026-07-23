'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditorRoot —— 移动端这棵树的数据容器。

   副作用(IndexedDB 取照片、blob URL、路由)只住在这里,展示层 MobileEditor 保持
   纯组件 → 能被 renderToStaticMarkup 直接断言(仓里没有 jsdom)。

   照片解析口径与桌面一致:屏显用 display 档派生图(不动原图,architecture invariant 1),
   本地没有时回落服务器压缩快照(photo-snapshot §5.3)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { photoStore } from '@/lib/photo/store';
import { presetImageUrl } from '@/lib/board-bg/presets';
import type { Locale } from '@/lib/i18n/routing';
import { collectPhotoIds, type ResolveImage } from '../../adapt-layout';
import { extractPhotoIds, type AlbumDetail } from '../../types';
import { MobileEditor } from './MobileEditor';
// 样式在容器里引:展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
import './mobile-editor.css';

export function MobileEditorRoot({ detail, locale }: { detail: AlbumDetail; locale: Locale }) {
  const router = useRouter();
  const pages = detail.pages;
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [uploadBgUrl, setUploadBgUrl] = useState<string | null>(null);

  const photoIds = useMemo(
    () => [
      ...new Set([
        ...extractPhotoIds(detail.album.layoutJson),
        ...collectPhotoIds(
          pages.map((p) => ({ templateId: p.templateId, images: p.imagesJson, texts: p.textsJson })),
        ),
      ]),
    ],
    [detail.album.layoutJson, pages],
  );

  useEffect(() => {
    let cancelled = false;
    void photoStore.getTierUrls(photoIds, 'display').then((urls) => {
      if (!cancelled) setImageUrls(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [photoIds]);

  // 用户上传的画板底图只存在本地(BoardBackground kind==='upload');取不到就回落无背景。
  const boardBg = detail.album.boardBackground ?? null;
  useEffect(() => {
    if (boardBg?.kind !== 'upload') {
      setUploadBgUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void photoStore
      .getBlob(boardBg.key)
      .catch(() => undefined)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUploadBgUrl(objectUrl);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boardBg]);

  const snapshotUrls = detail.album.photoSnapshotUrls ?? {};
  const resolve: ResolveImage = (id) => imageUrls[id] ?? snapshotUrls[id];

  const boardBackground =
    boardBg == null
      ? null
      : boardBg.kind === 'color'
        ? boardBg.color
        : boardBg.kind === 'preset'
          ? `center / cover no-repeat url("${presetImageUrl(boardBg.presetId)}")`
          : uploadBgUrl
            ? `center / cover no-repeat url("${uploadBgUrl}")`
            : null;

  return (
    <MobileEditor
      pages={pages}
      resolve={resolve}
      boardBackground={boardBackground}
      title={detail.album.title}
      onBack={() => router.push(`/${locale}/my-albums`)}
    />
  );
}
