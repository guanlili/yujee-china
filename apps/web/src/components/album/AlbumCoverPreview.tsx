'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { photoStore } from '@/lib/photo/store';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import { collectPhotoIds } from './adapt-layout';
import { PagePreview } from './PagePreview';
import { PAGE } from './templates/constants';
import type { EditorPage } from './types';

export type AlbumCoverPage = Pick<
  EditorPage,
  'pageIndex' | 'templateId' | 'imagesJson' | 'textsJson' | 'imagePosJson'
>;

interface Props {
  coverPage: AlbumCoverPage | null;
  coverThumbnailUrl?: string | null;
  photoFilter: PhotoFilterState | null;
  pageCount: number;
  fallback: ReactNode;
}

const THUMBNAIL_PADDING = 12;

export function AlbumCoverPreview({
  coverPage,
  coverThumbnailUrl,
  photoFilter,
  pageCount,
  fallback,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [scale, setScale] = useState(0.1);
  const [thumbBroken, setThumbBroken] = useState(false);

  useEffect(() => {
    setThumbBroken(false);
  }, [coverThumbnailUrl]);

  const photoIds = useMemo(() => {
    if (!coverPage) return [];
    return collectPhotoIds([
      {
        templateId: coverPage.templateId,
        images: coverPage.imagesJson,
        texts: coverPage.textsJson,
      },
    ]);
  }, [coverPage]);

  const photoKey = photoIds.join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 相册卡片封面:display 派生图(~1600px)足够,不解码原图。
      const urls = await photoStore.getTierUrls(photoKey ? photoKey.split(',') : [], 'display', photoFilter);
      if (!cancelled) setImageUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [photoKey, photoFilter]);

  const resolveImage = useCallback(
    (photoId: string) => imageUrls[photoId],
    [imageUrls],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateScale = () => {
      const availableWidth = Math.max(0, frame.clientWidth - THUMBNAIL_PADDING * 2);
      const availableHeight = Math.max(0, frame.clientHeight - THUMBNAIL_PADDING * 2);
      setScale(Math.min(availableWidth / PAGE.width, availableHeight / PAGE.height));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [coverPage]);

  if (coverThumbnailUrl && !thumbBroken) {
    return (
      <img
        src={coverThumbnailUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setThumbBroken(true)}
      />
    );
  }

  if (!coverPage) return <>{fallback}</>;

  return (
    <div
      ref={frameRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#eee8dc]"
    >
      <PagePreview
        page={coverPage}
        totalPages={Math.max(1, pageCount)}
        resolveImage={resolveImage}
        scale={scale}
      />
    </div>
  );
}
