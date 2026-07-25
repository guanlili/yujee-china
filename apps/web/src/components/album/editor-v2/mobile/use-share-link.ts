'use client';

/* ════════════════════════════════════════════════════════════════════════════
   分享链接(免登只读)—— 移动端那一份,与桌面 confirmShareLink 同一条链。

   顺序不能变:
     ① 先把书里用到的照片全量备份成公开快照
     ② **传不齐就停下,不发半残链接** —— 对方打开会缺图,比没有链接更糟
     ③ 全齐才让服务端把当前定稿冻结成分享,拿 token 拼 /{locale}/s/{token}
     ④ 尽量复制到剪贴板;复制失败也把链接显示出来让用户手动复制
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useState } from 'react';

import type { Locale } from '@/lib/i18n/routing';

export type ShareStage = 'idle' | 'uploading' | 'creating' | 'ready' | 'failed';

export type ShareState = {
  stage: ShareStage;
  /** 生成好的链接;null = 还没到第二步。 */
  link: string | null;
  /** 给用户看的一句话(上传中/差几张/已复制/失败)。 */
  hint: string | null;
};

const IDLE: ShareState = { stage: 'idle', link: null, hint: null };

export function useShareLink(albumId: string, locale: Locale, zh: boolean) {
  const [state, setState] = useState<ShareState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  /**
   * @param bookPhotoIds 书里用到的照片
   * @param backup 跑一轮照片备份,返回还差几张(见 use-photo-backup)
   */
  const create = useCallback(
    async (
      bookPhotoIds: string[],
      backup: (ids: string[]) => Promise<{ missing: number }>,
    ): Promise<void> => {
      setState({ stage: 'uploading', link: null, hint: zh ? '正在上传照片…' : 'Uploading photos…' });
      try {
        const { missing } = await backup(bookPhotoIds);
        if (missing > 0) {
          // 与桌面同一处置:明确告诉用户差几张、以及原图可能在另一台设备上。
          setState({
            stage: 'failed',
            link: null,
            hint: zh
              ? `还有 ${missing} 张照片没上传成功,先不生成链接。请重试;若原图不在这台设备,先去有原图的设备备份。`
              : `${missing} photo(s) failed to upload, so no link was created. Retry — or if the originals live on another device, back them up there first.`,
          });
          return;
        }
        setState({
          stage: 'creating',
          link: null,
          hint: zh ? '照片已上传,正在生成链接…' : 'Photos uploaded — creating link…',
        });
        const res = await fetch(`/api/v1/albums/${albumId}/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; data?: { token?: string } }
          | null;
        const token = json?.data?.token;
        if (!res.ok || !json?.ok || !token) throw new Error('share failed');
        const link = `${window.location.origin}/${locale}/s/${token}`;
        // 复制失败不算失败:链接已经有了,显示出来让用户自己复制。
        let copied = false;
        try {
          await navigator.clipboard.writeText(link);
          copied = true;
        } catch {
          copied = false;
        }
        setState({
          stage: 'ready',
          link,
          hint: copied
            ? zh
              ? '已复制到剪贴板 · 任何人打开即可只读查看'
              : 'Copied to clipboard · anyone with the link can view'
            : zh
              ? '链接已生成,请手动复制'
              : 'Link ready — copy it manually',
        });
      } catch {
        setState({
          stage: 'failed',
          link: null,
          hint: zh ? '生成失败,请重试' : 'Failed to generate, please retry',
        });
      }
    },
    [albumId, locale, zh],
  );

  const copy = useCallback(async () => {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setState((s) => ({
        ...s,
        hint: zh ? '已复制到剪贴板' : 'Copied to clipboard',
      }));
    } catch {
      setState((s) => ({ ...s, hint: zh ? '复制失败,请手动选中' : 'Copy failed — select it manually' }));
    }
  }, [state.link, zh]);

  return { state, create, copy, reset };
}
