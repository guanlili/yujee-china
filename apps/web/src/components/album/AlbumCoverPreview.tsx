'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { photoStore } from '@/lib/photo/store';
import { collectPhotoIds } from './adapt-layout';
import { PagePreview } from './PagePreview';
import type { EditorPage } from './types';

export type AlbumCoverPage = Pick<
  EditorPage,
  'pageIndex' | 'templateId' | 'imagesJson' | 'textsJson'
>;

interface Props {
  coverPage: AlbumCoverPage | null;
  pageCount: number;
  fallback: ReactNode;
}

export function AlbumCoverPreview({ coverPage, pageCount, fallback }: Props) {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

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

  if (!coverPage) return <>{fallback}</>;

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#eee8dc]">
      <PagePreview
        page={coverPage}
        totalPages={Math.max(1, pageCount)}
        resolveImage={resolveImage}
        scale={0.3}
      />
    </div>
  );
}
