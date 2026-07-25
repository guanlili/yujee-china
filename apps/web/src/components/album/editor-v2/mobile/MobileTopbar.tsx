'use client';

/* 顶栏:浏览态显示书名,编辑态显示「第 N 页」。右侧固定三枚 44pt 动作
   (分享 · 导出 · 更多),头像与画布控件都不进导航栏 —— 导航栏是「离开这屏去哪」,
   画布控件是「这屏怎么看」,后者落在画板左下角。 */

import { IconBack, IconShare, IconExport, IconMore } from './icons';

export type MobileTopbarProps = {
  title: string;
  zh: boolean;
  onBack: () => void;
  backLabel: string;
  /** 动作 handler 必填 —— 「可选」等于「可以不接」,漏一个就是死按钮。 */
  onShare: () => void;
  onExport: () => void;
  onMore: () => void;
};

export function MobileTopbar({
  title,
  zh,
  onBack,
  backLabel,
  onShare,
  onExport,
  onMore,
}: MobileTopbarProps) {
  return (
    <header className="mtopbar">
      <button type="button" className="mtb-btn" onClick={onBack} aria-label={backLabel}>
        <IconBack className="mtb-ic" />
      </button>
      <span className="mtopbar-title">{title}</span>
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
