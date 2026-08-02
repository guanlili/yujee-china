'use client';

// 照片原图对账补传(照片真相迁 R2 Phase 0, Task 8)的编辑器接线:纯逻辑住在
// photo-original-sync.ts(可单测),这里只做两件事:
//   1) 挂载起接管 photoStore 的远端原图 fetcher(本地未命中时的唯一回退源),
//      卸载/换相册必须收回 —— 它是模块级单例槽位,残留旧 fetcher 会替错的相册答题。
//   2) 每 (albumId + photoIds 签名) 探测一次服务端已上传集合并补传:本机 IndexedDB
//      里有、但服务端还没确认的原图,补传一遍。

import { useEffect, useRef } from 'react';

import {
  confirmPhotoOriginals,
  fetchPhotoOriginalUrls,
  putPhotoOriginalBlob,
  signPhotoOriginalUpload,
} from '@/lib/album/photo-original-client';
import { probeServerUploaded, runPhotoOriginalSync } from '@/lib/album/photo-original-sync';
import { photoStore } from '@/lib/photo/store';

export function usePhotoOriginalSync({
  albumId,
  photoIds,
  enabled,
}: {
  albumId: string;
  photoIds: string[];
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
  // photoIds 引用是否每次渲染都重新算出(调用方不强制 useMemo)。**不**用相册级
  // 聚合计数(album.photoOriginals 的 uploaded+missing)做「覆盖已完整」的早退
  // 判断:album_photos 的行从不 GC,书换过照片之后(比如 {A,B} 都已确认上传,
  // 书后来变成 {A,C})聚合数字(2)仍然 ≥ 当前书的去重张数(2),会把 C 永远
  // 漏掉 —— C 既不会被上传,也不会被标记为 missing。签名一新就总是跑一次探测;
  // 探测 + planPhotoOriginalSync 在「真的都传过」时天然零成本空转(不会有
  // sign/PUT/confirm 调用),多付出的只是每个新签名一次 /photo-originals/urls
  // 探测请求,这个成本是可接受的(review finding C1)。
  const ranSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !albumId || photoIds.length === 0) return;
    const uniquePhotoIds = [...new Set(photoIds)];
    const signature = `${albumId}::${[...uniquePhotoIds].sort().join(',')}`;
    if (ranSignatureRef.current === signature) return;
    ranSignatureRef.current = signature;
    void (async () => {
      // 断点续传的关键:先探测服务端已确认上传的集合,只把真正缺的那些送进
      // sign→put→confirm,否则每次触发都会把整本书重新传一遍(300 张全传成
      // 290 张,新增 1 张,也会把那 290 张再传一遍)。probeServerUploaded 内部
      // 已经把探测失败吞掉、退化为「当批候选照常重试」,这里不需要再兜一层
      // try/catch —— 它的契约就是绝不抛出。
      const serverUploaded = await probeServerUploaded(albumId, uniquePhotoIds, fetchPhotoOriginalUrls);
      await runPhotoOriginalSync({
        albumId,
        photoIds,
        serverUploaded,
        deps: {
          getCanonicalUploadBlob: (photoId) => photoStore.getCanonicalUploadBlob(photoId),
          sign: (id, entries) => signPhotoOriginalUpload(id, entries),
          put: (putUrl, blob) => putPhotoOriginalBlob(putUrl, blob),
          confirm: (id, confirmInput) => confirmPhotoOriginals(id, confirmInput),
        },
      });
    })();
  }, [albumId, photoIds, enabled]);
}
