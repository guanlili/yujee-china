'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditorRoot —— 移动端这棵树的数据容器。

   副作用(IndexedDB 取照片、blob URL、路由)只住在这里,展示层 MobileEditor 保持
   纯组件 → 能被 renderToStaticMarkup 直接断言(仓里没有 jsdom)。

   照片解析口径与桌面一致:屏显用 display 档派生图(不动原图,architecture invariant 1),
   本地没有时回落服务器压缩快照(photo-snapshot §5.3)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { photoStore } from '@/lib/photo/store';
import { presetImageUrl } from '@/lib/board-bg/presets';
import type { Locale } from '@/lib/i18n/routing';
import { collectPhotoIds, type ResolveImage } from '../../adapt-layout';
import { extractPhotoIds, type AlbumDetail } from '../../types';
import { MobileEditor } from './MobileEditor';
// 样式在容器里引:展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
// token 与桌面共用同一份(共享设计系统,不共享 DOM)。
import '../editor-tokens.css';
import './mobile-editor.css';

export function MobileEditorRoot({
  detail,
  locale,
  onBack,
}: {
  detail: AlbumDetail;
  locale: Locale;
  /** 顶栏返回。默认回「我的相册」;dev 预览页覆盖它,免得一点就被踢出预览。 */
  onBack?: () => void;
}) {
  const router = useRouter();
  const pages = detail.pages;
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  // 缩略档单独取:书册预览栏一条几十页,用主画布的 display 档会拖垮解码与滚动。
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
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
    void photoStore.getTierUrls(photoIds, 'thumb').then((urls) => {
      if (!cancelled) setThumbUrls(urls);
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

  const snapshotUrls = useMemo(
    () => detail.album.photoSnapshotUrls ?? {},
    [detail.album.photoSnapshotUrls],
  );
  // 两档都要稳定引用:缩略条按 ctx 引用做 memo,每帧新函数会让整条重渲。
  const resolve: ResolveImage = useCallback(
    (id) => imageUrls[id] ?? snapshotUrls[id],
    [imageUrls, snapshotUrls],
  );
  const resolveThumb: ResolveImage = useCallback(
    (id) => thumbUrls[id] ?? imageUrls[id] ?? snapshotUrls[id],
    [thumbUrls, imageUrls, snapshotUrls],
  );

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
      resolveThumb={resolveThumb}
      boardBackground={boardBackground}
      title={detail.album.title}
      onBack={onBack ?? (() => router.push(`/${locale}/my-albums`))}
    />
  );
}
