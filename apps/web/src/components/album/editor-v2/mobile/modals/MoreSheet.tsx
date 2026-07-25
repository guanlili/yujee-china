'use client';

/* 「更多」菜单。

   存在的理由:线上顶栏有「保存」(= 照片备份 backupPhotos),而移动端顶栏按设计稿
   精简成只留分享 + 导出,保存与头像整个隐藏(editor-port.css ≤767 段的注释写明了)。
   于是这个线上有的能力在手机上一直没有入口 —— 现在收进「更多」。

   结构复用桌面导出菜单那套 .export-sheet / .export-opt,视觉不另起一套。 */

import { ModalHost } from './ModalHost';
import type { BackupState } from '../use-photo-backup';

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function MoreSheet({
  open,
  zh,
  backupState,
  backupProgress,
  onClose,
  onBackupPhotos,
}: {
  open: boolean;
  zh: boolean;
  backupState: BackupState;
  backupProgress: { done: number; total: number } | null;
  onClose: () => void;
  onBackupPhotos: () => void;
}) {
  const backupLabel = () => {
    if (backupState === 'backing-up') {
      const p = backupProgress;
      return zh
        ? `正在备份照片…${p ? ` ${p.done}/${p.total}` : ''}`
        : `Backing up photos…${p ? ` ${p.done}/${p.total}` : ''}`;
    }
    if (backupState === 'backed-up') return zh ? '照片已备份' : 'Photos backed up';
    if (backupState === 'failed') return zh ? '备份未完成,点一下重试' : 'Backup incomplete — tap to retry';
    return zh ? '备份照片到云端' : 'Back up photos to the cloud';
  };

  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="export-sheet"
      labelledBy="mMoreTitle"
      testId="more-sheet"
    >
      <div className="px-6 pt-5 pb-1">
        <h3 id="mMoreTitle" className="font-display text-[18px] font-bold">
          {zh ? '更多' : 'More'}
        </h3>
        <p className="text-[13px] text-muted mt-1">
          {zh
            ? '照片只存在这台设备上。备份后换设备/清缓存也能看到内页图。'
            : 'Photos live only on this device. Back them up so pages still show after switching devices.'}
        </p>
      </div>
      <div className="px-5 py-4 flex flex-col gap-2.5">
        <button
          className="export-opt"
          onClick={onBackupPhotos}
          disabled={backupState === 'backing-up'}
          data-testid="more-backup"
          data-backup-state={backupState}
        >
          <svg {...stroke}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{backupLabel()}</span>
        </button>
      </div>
      <div className="px-5 pb-5">
        <button className="export-cancel" onClick={onClose}>
          {zh ? '关闭' : 'Close'}
        </button>
      </div>
    </ModalHost>
  );
}

/* ── 一句话告知框(Live 视频不支持这类「不是失败、但要说清楚」的情形) ────────── */
export function NoticeModal({
  open,
  zh,
  title,
  message,
  onClose,
}: {
  open: boolean;
  zh: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <ModalHost open={open} onClose={onClose} labelledBy="mNoticeTitle" testId="notice-modal">
      <div className="px-6 pt-6 pb-3">
        <h3 id="mNoticeTitle" className="font-display text-[17px] font-bold">
          {title}
        </h3>
        <p className="text-[13px] text-muted mt-3 leading-relaxed">{message}</p>
      </div>
      <div className="px-6 py-4 flex items-center justify-end">
        <button
          className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg"
          onClick={onClose}
        >
          {zh ? '知道了' : 'Got it'}
        </button>
      </div>
    </ModalHost>
  );
}
