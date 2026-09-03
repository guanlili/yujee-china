'use client';

// 协同编辑面板(collab plan §15 / Task 8)。owner 专用:
//   - 生成/旋转编辑链接 + 复制;
//   - 成员列表 + 移除;
//   - 后端错误(PHOTO_BACKUP_REQUIRED / CHAT_BUSY / COLLAB_UNSUPPORTED_ALBUM)
//     就地提示。
// editor 角色不渲染此面板(顶栏入口由 role 隐藏,后端仍兜底)。

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  createEditLink,
  listMembers,
  removeMember,
  CollabClientError,
  type CollabMember,
} from '@/lib/collaboration/collaboration-client';
import { boundPick, type AT } from '@/lib/i18n/pick';

type PanelState = {
  link: string | null;
  members: CollabMember[];
  busy: boolean;
  hint: string | null;
};

const EMPTY: PanelState = { link: null, members: [], busy: false, hint: null };

export function CollabPanel({
  albumId,
  locale,
  onClose,
  variant = 'dialog',
}: {
  albumId: string;
  locale: string;
  onClose: () => void;
  variant?: 'dialog' | 'sheet';
}) {
  // 必须 useMemo:boundPick 每次调用返回新引用,裸写会让下面的 refresh useCallback
  // 每次渲染都重建 → useEffect [refresh] 无限重触发 → /members 请求风暴
  // (真实打开面板即浏览器 ERR_INSUFFICIENT_RESOURCES,2026-08-28 线上实测)。
  const aT = useMemo(() => boundPick(locale as never) as AT, [locale]);
  const [state, setState] = useState<PanelState>(EMPTY);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, hint: null }));
    try {
      const members = await listMembers(albumId);
      setState((s) => ({ ...s, members, busy: false }));
    } catch {
      setState((s) => ({ ...s, busy: false, hint: aT('加载成员失败', 'Failed to load members') }));
    }
  }, [albumId, aT]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const create = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, hint: null }));
    try {
      const { token } = await createEditLink(albumId);
      const url = `${window.location.origin}/${locale}/join/${encodeURIComponent(token)}`;
      setState((s) => ({ ...s, busy: false, link: url }));
    } catch (e) {
      setState((s) => ({
        ...s,
        busy: false,
        hint: hintFor(e, aT),
      }));
    }
  }, [albumId, aT]);

  const copy = useCallback(async () => {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setState((s) => ({ ...s, hint: aT('已复制到剪贴板', 'Copied to clipboard') }));
    } catch {
      setState((s) => ({ ...s, hint: aT('复制失败,请手动选中', 'Copy failed — select it manually') }));
    }
  }, [state.link, aT]);

  const remove = useCallback(
    async (userId: string) => {
      setState((s) => ({ ...s, busy: true }));
      try {
        await removeMember(albumId, userId);
        await refresh();
      } catch {
        setState((s) => ({ ...s, busy: false, hint: aT('移除失败,请重试', 'Remove failed — retry') }));
      }
    },
    [albumId, refresh, aT],
  );

  return (
    <div className={`collab-panel fixed inset-0 z-[70] flex px-4${variant === 'sheet' ? ' items-end justify-center' : ' items-center justify-center'}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]${variant === 'sheet' ? ' rounded-t-[var(--radius-lg)] rounded-b-none' : ' rounded-[var(--radius-lg)]'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-[17px] font-bold text-[var(--fg)]">
            {aT('协作编辑', 'Collaborate')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-black/[.05]"
            aria-label={aT('关闭', 'Close')}
          >
            ✕
          </button>
        </div>

        {/* 邀请链接 */}
        <div className="mb-5">
          <p className="mb-2 text-[13px] text-[var(--muted)]">
            {aT('邀请他人共同编辑。重新生成后旧链接失效。', 'Invite others to co-edit. Regenerating revokes the old link.')}
          </p>
          {state.link ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate rounded-pill border border-bd bg-bg px-3 py-2 text-[12px] text-fg">
                {state.link}
              </div>
              <button
                onClick={copy}
                className="shrink-0 rounded-pill border border-bd px-3 py-2 text-[12px] font-semibold text-fg2"
              >
                {aT('复制', 'Copy')}
              </button>
            </div>
          ) : null}
          <button
            onClick={create}
            disabled={state.busy}
            className="mt-2 w-full rounded-pill bg-fg px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-45"
          >
            {state.link
              ? aT('重新生成链接(旧链接失效)', 'Regenerate link (revokes old)')
              : aT('生成编辑链接', 'Create edit link')}
          </button>
        </div>

        {/* 成员列表 */}
        <div className="min-h-0 overflow-y-auto">
          <p className="mb-2 text-[13px] font-semibold text-[var(--fg)]">
            {aT('已加入的协作者', 'Members')}
          </p>
          {state.members.length === 0 ? (
            <p className="text-[13px] text-[var(--muted)]">
              {aT('还没有协作者', 'No members yet')}
            </p>
          ) : (
            <ul className="space-y-2">
              {state.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 truncate">
                    <span className="text-[13px] font-medium text-[var(--fg)]">
                      {m.name ?? m.email}
                    </span>
                    {m.name ? (
                      <span className="ml-2 text-[12px] text-[var(--muted)]">{m.email}</span>
                    ) : null}
                  </div>
                  <button
                    onClick={() => void remove(m.userId)}
                    disabled={state.busy}
                    className="shrink-0 rounded-pill border border-bd px-3 py-1.5 text-[12px] font-semibold text-fg2 hover:bg-black/[.03] disabled:opacity-45"
                  >
                    {aT('移除', 'Remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {state.hint ? (
          <p className="mt-4 text-[12px] leading-relaxed text-[var(--meta)]">{state.hint}</p>
        ) : null}
      </div>
    </div>
  );
}

function hintFor(e: unknown, aT: AT): string {
  const code = e instanceof CollabClientError ? e.code : '';
  if (code === 'PHOTO_BACKUP_REQUIRED') {
    return aT('还有照片没备份到服务器,请先保存到云端再邀请', 'Some photos are not backed up yet — save to cloud first');
  }
  if (code === 'CHAT_BUSY') {
    return aT('有生成任务正在进行,请稍后再试', 'A generation job is running — try again shortly');
  }
  if (code === 'COLLAB_UNSUPPORTED_ALBUM') {
    return aT('这本相册暂不支持协作编辑', 'This album does not support collaboration');
  }
  return aT('生成失败,请重试', 'Failed to create — retry');
}
