'use client';

/* 顶栏:浏览态显示书名,编辑态显示「第 N 页」。右侧四枚 44pt 动作
   (保存 · 分享 · 导出 · 更多),头像与画布控件都不进导航栏 —— 导航栏是「离开这屏去哪」,
   画布控件是「这屏怎么看」,后者落在画板左下角。

   「保存」= 照片备份到云端(photo-snapshot),与桌面顶栏那枚同义,不是保存文字/排版
   —— 那些是改完即落库的。原先只藏在「更多」里,桌面却是一等入口,两端不齐;而且
   照片只存在本地(invariant 1),不备份就换设备即空白,值得摆在顶栏。
   备份态直接长在按钮上(同桌面 save-btn 的 data-backup-state):进行中转圈、成功打勾、
   失败标红,不另弹提示。 */

import { IconBack, IconShare, IconExport, IconMore, IconSave } from './icons';

export type BackupState = 'idle' | 'backing-up' | 'backed-up' | 'failed';

export type MobileTopbarProps = {
  title: string;
  zh: boolean;
  onBack: () => void;
  backLabel: string;
  /** 动作 handler 必填 —— 「可选」等于「可以不接」,漏一个就是死按钮。 */
  onSave: () => void;
  /** 备份态:长在保存按钮上,不另弹提示。 */
  backupState: BackupState;
  /** 备份进度(已传/总数);running 时显示在按钮上。 */
  backupProgress: { done: number; total: number } | null;
  onShare: () => void;
  onExport: () => void;
  onMore: () => void;
};

export function MobileTopbar({
  title,
  zh,
  onBack,
  backLabel,
  onSave,
  backupState,
  backupProgress,
  onShare,
  onExport,
  onMore,
}: MobileTopbarProps) {
  const saveLabel =
    backupState === 'backing-up'
      ? backupProgress
        ? `${zh ? '备份中' : 'Backing up'} ${backupProgress.done}/${backupProgress.total}`
        : zh
          ? '备份中'
          : 'Backing up'
      : backupState === 'backed-up'
        ? zh
          ? '已备份'
          : 'Backed up'
        : backupState === 'failed'
          ? zh
            ? '备份失败'
            : 'Backup failed'
          : zh
            ? '保存到云端:备份照片,换设备也能看'
            : 'Save to cloud: back up photos so you can view on any device';
  return (
    <header className="mtopbar">
      <button type="button" className="mtb-btn" onClick={onBack} aria-label={backLabel}>
        <IconBack className="mtb-ic" />
      </button>
      <span className="mtopbar-title">{title}</span>
      <button
        type="button"
        className="mtb-btn mtb-save"
        onClick={onSave}
        // 备份中再点会被 hook 的 running 闸挡掉,但按钮该先显出不可点,别让人干等。
        disabled={backupState === 'backing-up'}
        data-backup-state={backupState}
        aria-label={saveLabel}
        title={saveLabel}
      >
        <IconSave className="mtb-ic" />
        <span className="mtb-dot" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mtb-btn"
        onClick={onShare}
        aria-label={zh ? '分享' : 'Share'}
      >
        <IconShare className="mtb-ic" />
      </button>
      <button
        type="button"
        className="mtb-btn"
        onClick={onExport}
        aria-label={zh ? '导出' : 'Export'}
      >
        <IconExport className="mtb-ic" />
      </button>
      <button type="button" className="mtb-btn" onClick={onMore} aria-label={zh ? '更多' : 'More'}>
        <IconMore className="mtb-ic" />
      </button>
    </header>
  );
}
