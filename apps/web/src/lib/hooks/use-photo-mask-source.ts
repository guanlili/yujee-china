'use client';

/**
 * 抠图 mask 的取数口 + 生成触发(编辑器两个壳共用)。
 *
 * 浏览器端那套抠图是从四边漫水填充,**没有语义** —— 2026-08-29 实测棚拍人像
 * 5 张 0 张能用,自动抠图因此被否决。渲染必须优先用服务端 isnet 的分割 mask
 * (`album_photos.profile.maskKey` → R2 的一张 PNG),拿不到才退回。
 *
 * 两件事:
 *
 * 1. **取数**:挂载起接管 photoStore 的 mask fetcher,卸载/换相册收回。它是模块级
 *    单例槽位(同 setRemoteOriginalFetcher),残留的 fetcher 会替错的相册答题。
 *
 * 2. **触发**:「现在开着抠图的是哪几张」一变(含挂载时本来就有的那批),就请服务端
 *    把缺的 mask 补上。**不等结果** —— isnet 单张 ~4s。
 *    - 走独立的 `POST /photo-masks`,不挂在滤镜 PATCH 上:挂上去用户点一下要等
 *      几十秒;而 Vercel 上「响应之后再跑」的浮空 Promise 不保证执行,所以也不能
 *      在 PATCH 里 fire-and-forget。
 *    - 覆盖三种情形,一条判据搞定:手工新开的、Agent 开的、存量书里早就开着但
 *      从没生成过 mask 的(以及上一轮超上限没跑完 / 推理挂了的)。
 *    - mask 到货后必须 `forgetPhotoMasks` + 让画面重来一次:此前的渲染已经记住
 *      「这张没有 mask」并退回了兜底,不清的话这一整个会话都看不到好的那版。
 */

import { useEffect, useRef } from 'react';

import { fetchPhotoMaskUrls, requestCutoutMasks } from '@/lib/album/photo-mask-client';
import { cutoutSignature, type PhotoFilterState } from '@/lib/photo/filter-state';
import { photoStore } from '@/lib/photo/store';

export function usePhotoMaskSource(
  albumId: string,
  photoFilter: PhotoFilterState | null,
  onMasksReady?: () => void,
): void {
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

  // 回调经 ref 取最新:下面那个 effect 只按「抠图集合的签名」重跑,把回调放进依赖
  // 会让每次父组件重渲染都重打一枪。
  const onMasksReadyRef = useRef(onMasksReady);
  onMasksReadyRef.current = onMasksReady;

  // 已经为哪个签名打过枪。签名与键序无关(cutoutSignature 排过序),所以同一批照片
  // 不会因为合并顺序变化被反复当成「变了」—— 那等于每次滤镜保存都白烧一次推理。
  const requestedRef = useRef<string | null>(null);
  const signature = cutoutSignature(photoFilter);
  useEffect(() => {
    if (!albumId || signature === '') return;
    const key = `${albumId}::${signature}`;
    if (requestedRef.current === key) return;
    requestedRef.current = key;
    // fire-and-forget:不阻塞渲染,失败也不冒泡(requestCutoutMasks 自己吞)。
    void (async () => {
      const { created } = await requestCutoutMasks(albumId);
      if (created.length === 0) return;
      photoStore.forgetPhotoMasks(created);
      onMasksReadyRef.current?.();
    })();
  }, [albumId, signature]);
}
