'use client';

/* ════════════════════════════════════════════════════════════════════════════
   照片备份(photo-snapshot-design.md §5.1)—— 移动端那一份。

   与桌面 backupPhotos 同一条链、同一批客户端函数:
     签名(signPhotoSnapshotUpload) → 限并发直传 R2(putSnapshotBlob) → confirm。
   **原图不上传**,上传的是 display 档压缩图(invariant 1)。

   桌面这段挂在顶栏「保存」按钮上,而移动端顶栏按设计稿精简掉了保存与头像 ——
   于是它在手机上一直没有入口。现在挂进「更多」菜单。

   分享链接必须先跑完这条:分享页在对方浏览器渲染,那里没有本机 IndexedDB 的原图,
   照片快照不全量上云对方就看不到图。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';

import { photoStore } from '@/lib/photo/store';
import {
  confirmPhotoSnapshot,
  putSnapshotBlob,
  signPhotoSnapshotUpload,
} from '@/lib/album/photo-snapshot-client';

/** 与桌面同一并发度:4 路直传,单张失败不阻断其余。 */
const UPLOAD_CONCURRENCY = 4;

export type BackupState = 'idle' | 'backing-up' | 'backed-up' | 'failed';

export type BackupResult = {
  /** 这一轮之后仍没备份成功的照片数(0 = 全齐,分享才允许继续)。 */
  missing: number;
  uploaded: number;
};

export function usePhotoBackup(albumId: string, alreadyBackedUp: string[]) {
  const [state, setState] = useState<BackupState>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // 已备份集合跨多次调用累积(换页/重试都不该重传已成功的那些)。
  const backedUp = useRef<Set<string>>(new Set(alreadyBackedUp));
  const running = useRef(false);

  /** 把书里用到、本地有、尚未备份的照片传上去。返回这一轮之后还差几张。 */
  const backup = useCallback(
    async (bookPhotoIds: string[]): Promise<BackupResult> => {
      const missingOf = () => bookPhotoIds.filter((id) => !backedUp.current.has(id));
      if (running.current) return { missing: missingOf().length, uploaded: 0 };
      const todo = missingOf();
      if (todo.length === 0) {
        setState('backed-up');
        return { missing: 0, uploaded: 0 };
      }
      running.current = true;
      setState('backing-up');
      setProgress({ done: 0, total: todo.length });
      try {
        // 只备份本地有的:getTierBlob 为空 = 原图不在本机,跳过(那些只能在有原图的设备上备份)。
        const pairs: { photoId: string; blob: Blob }[] = [];
        for (const id of todo) {
          const blob = await photoStore.getTierBlob(id, 'display').catch(() => undefined);
          if (blob) pairs.push({ photoId: id, blob });
        }
        if (pairs.length === 0) {
          setState('failed');
          return { missing: todo.length, uploaded: 0 };
        }
        const signed = await signPhotoSnapshotUpload(
          albumId,
          pairs.map((p) => p.photoId),
        );
        const urlById = new Map(signed.map((s) => [s.photoId, s.putUrl]));
        const uploaded: string[] = [];
        const queue = [...pairs];
        let done = 0;
        const worker = async () => {
          for (;;) {
            const item = queue.shift();
            if (!item) return;
            const putUrl = urlById.get(item.photoId);
            if (!putUrl) continue;
            try {
              await putSnapshotBlob(putUrl, item.blob);
              uploaded.push(item.photoId);
            } catch {
              /* 单张失败不阻断其余;下面只登记成功的,不谎报全备份 */
            }
            done += 1;
            setProgress({ done, total: pairs.length });
          }
        };
        await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
        if (uploaded.length === 0) {
          setState('failed');
          return { missing: todo.length, uploaded: 0 };
        }
        await confirmPhotoSnapshot(albumId, uploaded);
        uploaded.forEach((id) => backedUp.current.add(id));
        const missing = missingOf().length;
        setState(missing === 0 ? 'backed-up' : 'failed');
        return { missing, uploaded: uploaded.length };
      } catch {
        setState('failed');
        return { missing: missingOf().length, uploaded: 0 };
      } finally {
        running.current = false;
        setProgress(null);
      }
    },
    [albumId],
  );

  return { state, progress, backup };
}
