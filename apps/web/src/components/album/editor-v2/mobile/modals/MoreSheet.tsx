'use client';

/* 「更多」菜单。

   存在的理由:线上顶栏有「保存」(= 照片备份 backupPhotos),而移动端顶栏按设计稿
   精简成只留分享 + 导出,保存与头像整个隐藏(editor-port.css ≤767 段的注释写明了)。
   于是这个线上有的能力在手机上一直没有入口 —— 现在收进「更多」。

   结构复用桌面导出菜单那套 .export-sheet / .export-opt,视觉不另起一套。 */

import { ModalHost } from './ModalHost';
import type { BackupState } from '../use-photo-backup';
import type { AT } from '@/lib/i18n/pick';

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
  aT,
  backupState,
  backupProgress,
  lutSupported,
  onClose,
  onReorderPages,
  onBackupPhotos,
  onRebackupPhotos,
  onPhotoFilter,
}: {
  open: boolean;
  aT: AT;
  backupState: BackupState;
  backupProgress: { done: number; total: number } | null;
  lutSupported: boolean;
  onClose: () => void;
  /** 页序弹窗入口(2026-08-02):打开 ReorderSheet 拖拽调整页面顺序。 */
  onReorderPages: () => void;
  onBackupPhotos: () => void;
  /** 整本重传一遍。上传档从 1600 提到 3400 之后,存量备份不会自动升级 ——
   *  档位不进 renderVersion(进了会把存量分享全打成 409),升档只能靠用户点这一条。 */
  onRebackupPhotos: () => void;
  onPhotoFilter: () => void;
}) {
  const backupLabel = () => {
    if (backupState === 'backing-up') {
      const p = backupProgress;
      return aT(
        `正在备份照片…${p ? ` ${p.done}/${p.total}` : ''}`,
        `Backing up photos…${p ? ` ${p.done}/${p.total}` : ''}`,
      );
    }
    if (backupState === 'backed-up') return aT('照片已备份', 'Photos backed up');
    if (backupState === 'failed') return aT('备份未完成,点一下重试', 'Backup incomplete — tap to retry');
    return aT('备份照片到云端', 'Back up photos to the cloud');
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
          {aT('更多', 'More')}
        </h3>
        <p className="text-[13px] text-muted mt-1">
          {aT('照片只存在这台设备上。备份后换设备/清缓存也能看到内页图。', 'Photos live only on this device. Back them up so pages still show after switching devices.')}
        </p>
      </div>
      <div className="px-5 py-4 flex flex-col gap-2.5">
        <button className="export-opt" onClick={onReorderPages} data-testid="more-reorder">
          <svg {...stroke}>
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          <span>{aT('调整页面顺序', 'Reorder pages')}</span>
        </button>
        {lutSupported && (
          <button
            className="export-opt"
            onClick={onPhotoFilter}
            data-testid="more-photo-filter"
          >
            <svg {...stroke}>
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h16" />
              <circle cx="9" cy="6" r="2" fill="currentColor" />
              <circle cx="15" cy="12" r="2" fill="currentColor" />
              <circle cx="11" cy="18" r="2" fill="currentColor" />
            </svg>
            <span>{aT('全书照片风格', 'Whole-book photo style')}</span>
          </button>
        )}
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
        {/* 只在「已经备份过」时出现:没备份过的书点上面那条就够了,这条会是多余的第二个入口。
            存量备份是老的 1600 档,导出会糊;重传一遍覆盖成 3400。 */}
        {backupState === 'backed-up' && (
          <button
            className="export-opt"
            onClick={onRebackupPhotos}
            data-testid="more-rebackup"
          >
            <svg {...stroke}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span>{aT('重新备份(提升导出画质)', 'Re-back up (better export quality)')}</span>
          </button>
        )}
      </div>
      <div className="px-5 pb-5">
        <button className="export-cancel" onClick={onClose}>
          {aT('关闭', 'Close')}
        </button>
      </div>
    </ModalHost>
  );
}

/* ── 一句话告知框(Live 视频不支持这类「不是失败、但要说清楚」的情形) ────────── */
export function NoticeModal({
  open,
  aT,
  title,
  message,
  onClose,
}: {
  open: boolean;
  aT: AT;
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
          {aT('知道了', 'Got it')}
        </button>
      </div>
    </ModalHost>
  );
}
