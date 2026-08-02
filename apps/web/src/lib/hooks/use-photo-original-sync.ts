'use client';

// 照片原图对账补传(照片真相迁 R2 Phase 0, Task 8)的编辑器接线:纯逻辑住在
// photo-original-sync.ts(可单测),这里只做两件事:
//   1) 挂载起接管 photoStore 的远端原图 fetcher(本地未命中时的唯一回退源),
//      卸载/换相册必须收回 —— 它是模块级单例槽位,残留旧 fetcher 会替错的相册答题。
//   2) 每 (albumId + photoIds 签名) 触发一次补传:本机 IndexedDB 里有、但服务端
//      album.photoOriginals 覆盖不全的原图,补传一遍。

import { useEffect, useRef } from 'react';

import {
  confirmPhotoOriginals,
  fetchPhotoOriginalUrls,
  putPhotoOriginalBlob,
  signPhotoOriginalUpload,
} from '@/lib/album/photo-original-client';
import { runPhotoOriginalSync } from '@/lib/album/photo-original-sync';
import { photoStore } from '@/lib/photo/store';

export function usePhotoOriginalSync({
  albumId,
  photoIds,
  photoOriginals,
  enabled,
}: {
  albumId: string;
  photoIds: string[];
  photoOriginals?: { uploaded: number; missing: number };
  enabled: boolean;
}): void {
  // 远端原图 fetcher:单张 fetchPhotoOriginalUrls + fetch(url) → blob。任何一步失败
  // (404/网络/解析)一律回 undefined —— 让 photoStore 落回既有的「本地没有」处置,
  // 不让这条回退路径的问题冒泡到调用方。
  useEffect(() => {
    if (!albumId) return undefined;
    photoStore.setRemoteOriginalFetcher(async (photoId) => {
      try {
        const urls = await fetchPhotoOriginalUrls(albumId, [photoId]);
        const url = urls[photoId];
        if (!url) return undefined;
        const res = await fetch(url);
        if (!res.ok) return undefined;
        return await res.blob();
      } catch {
        return undefined;
      }
    });
    return () => {
      photoStore.setRemoteOriginalFetcher(null);
    };
  }, [albumId]);

  // 补传对账:签名(albumId + 去重排序后的 photoIds)相同则只跑一次 —— 无论
  // photoIds 引用是否每次渲染都重新算出(调用方不强制 useMemo)。
  const ranSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !albumId || photoIds.length === 0) return;
    const uniquePhotoIds = [...new Set(photoIds)];
    const uploaded = photoOriginals?.uploaded ?? 0;
    const missing = photoOriginals?.missing ?? 0;
    if (uploaded + missing >= uniquePhotoIds.length) return;
    const signature = `${albumId}::${[...uniquePhotoIds].sort().join(',')}`;
    if (ranSignatureRef.current === signature) return;
    ranSignatureRef.current = signature;
    void runPhotoOriginalSync({
      albumId,
      photoIds,
      // 客户端只拿得到聚合计数(uploaded/missing 的数量),拿不到具体已上传的
      // photoId 集合 —— 这里传空集,让 planPhotoOriginalSync 把本轮全部 photoIds
      // 当作候选;photoId 幂等,已经上传过的重新过一遍 sign→put→confirm 也无害。
      serverUploaded: new Set(),
      deps: {
        getCanonicalUploadBlob: (photoId) => photoStore.getCanonicalUploadBlob(photoId),
        sign: (id, entries) => signPhotoOriginalUpload(id, entries),
        put: (putUrl, blob) => putPhotoOriginalBlob(putUrl, blob),
        confirm: (id, confirmInput) => confirmPhotoOriginals(id, confirmInput),
      },
    });
  }, [albumId, photoIds, photoOriginals?.uploaded, photoOriginals?.missing, enabled]);
}
