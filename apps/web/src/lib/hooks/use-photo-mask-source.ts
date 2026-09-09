'use client';

/**
 * 抠图 mask 的取数口接线(编辑器两个壳共用)。
 *
 * 浏览器端那套抠图是从四边漫水填充,**没有语义** —— 2026-08-29 实测棚拍人像
 * 5 张 0 张能用,自动抠图因此被否决。现在 Agent 能自动开抠图,渲染必须优先用服务端
 * isnet 的分割 mask(`album_photos.profile.maskKey` → R2 的一张 PNG),拿不到才退回。
 *
 * 这里只做一件事:挂载起接管 photoStore 的 mask fetcher,卸载/换相册收回。
 * 它是**模块级单例槽位**(同 setRemoteOriginalFetcher),残留的 fetcher 会替错的
 * 相册答题 —— 所以 cleanup 必须传 null。
 */

import { useEffect } from 'react';

import { fetchPhotoMaskUrls } from '@/lib/album/photo-mask-client';
import { photoStore } from '@/lib/photo/store';

export function usePhotoMaskSource(albumId: string): void {
  useEffect(() => {
    if (!albumId) return undefined;
    photoStore.setPhotoMaskFetcher(async (photoId) => {
      // 任何一步失败(没 mask / 网络 / 解析)一律回 undefined —— 渲染会落回浏览器端
      // 抠图,绝不让这条回退路径的问题冒泡到调用方。photoStore 自己按 photoId 记忆,
      // 所以这里不必再做去重。
      try {
        const urls = await fetchPhotoMaskUrls(albumId, [photoId]);
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
      photoStore.setPhotoMaskFetcher(null);
    };
  }, [albumId]);
}
