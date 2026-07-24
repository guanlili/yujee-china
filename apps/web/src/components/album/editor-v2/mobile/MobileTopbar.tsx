'use client';

/* 顶栏:浏览态显示书名,编辑态显示「第 N 页」。右侧固定三枚 44pt 动作
   (分享 · 导出 · 更多),头像与画布控件都不进导航栏 —— 导航栏是「离开这屏去哪」,
   画布控件是「这屏怎么看」,后者落在画板左下角。 */

import { IconBack, IconShare, IconExport, IconMore } from './icons';

export type MobileTopbarProps = {
  title: string;
  onBack: () => void;
  backLabel: string;
  onShare?: () => void;
  onExport?: () => void;
  onMore?: () => void;
};

export function MobileTopbar({
  title,
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
      <button type="button" className="mtb-btn" onClick={onShare} aria-label="分享">
        <IconShare className="mtb-ic" />
      </button>
      <button type="button" className="mtb-btn" onClick={onExport} aria-label="导出">
        <IconExport className="mtb-ic" />
      </button>
      <button type="button" className="mtb-btn" onClick={onMore} aria-label="更多">
        <IconMore className="mtb-ic" />
      </button>
    </header>
  );
}
