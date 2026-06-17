'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { photoStore } from '@/lib/photo/store';
import { collectPhotoIds } from './adapt-layout';
import { PagePreview } from './PagePreview';
import { PAGE } from './templates/constants';
import type { EditorPage } from './types';

export type AlbumCoverPage = Pick<
  EditorPage,
  'pageIndex' | 'templateId' | 'imagesJson' | 'textsJson'
>;

interface Props {
  coverPage: AlbumCoverPage | null;
  pageCount: number;
  fallback: ReactNode;
  // #167: persistent cover thumbnail (rasterized first page stored in R2). When
  // present this is the source of truth — a plain <img>, no photoStore needed —
  // so covers survive new sessions/devices where the browser photoStore is empty.
  coverThumbnailUrl?: string | null;
}

const THUMBNAIL_PADDING = 12;

export function AlbumCoverPreview({ coverPage, pageCount, fallback, coverThumbnailUrl }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [scale, setScale] = useState(0.1);
  // If the stored thumbnail 404s/errors (e.g. deleted in R2), fall back to the
  // live photoStore render path below rather than showing a broken image.
  const [thumbBroken, setThumbBroken] = useState(false);

  // Reset the broken flag whenever the URL changes — a re-uploaded thumbnail gets
  // a fresh `?v=...` URL, so a cover that previously 404'd should retry the stored
  // image instead of being stuck on the photoStore fallback forever.
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
      const urls = await photoStore.getObjectUrls(photoKey ? photoKey.split(',') : []);
      if (!cancelled) setImageUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [photoKey]);

  const resolveImage = useCallback((photoId: string) => imageUrls[photoId], [imageUrls]);

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

  // #167: prefer the stored thumbnail. It's a self-contained rendered image, so it
  // works with no photoStore (other devices / cleared cache) — the whole point of
  // the feature. The live-render path below stays as the same-session fallback
  // (just-created album whose thumbnail upload may still be in flight) and as the
  // degraded path if the stored image fails to load.
  const useStoredThumb = !!coverThumbnailUrl && !thumbBroken;
  if (useStoredThumb) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[#eee8dc]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverThumbnailUrl}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setThumbBroken(true)}
        />
      </div>
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
