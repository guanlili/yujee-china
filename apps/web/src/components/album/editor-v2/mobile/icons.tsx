/* 移动端图标。沿用仓里既有的 lucide 笔法(24×24 viewBox / stroke 1.75 / round),
   与桌面 EditorPort 的图标同族,但这棵树自己持有一份 —— 不跨树引用彼此的 DOM/资源。 */

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function IconBack({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function IconShare({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

export function IconExport({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function IconMore({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 画板垫底背景(图层) */
export function IconBoardBg({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

/** 页面底色(背景) */
export function IconPageBg({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

export function IconImage({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5L9 20" />
    </svg>
  );
}

export function IconText({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6V5h16v1" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="9" y1="19" x2="15" y2="19" />
    </svg>
  );
}

export function IconTrash({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/** 顶栏「保存」= 备份照片到云端。图形取自桌面 save-btn 的同一个软盘,不自创。 */
export function IconSave({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

/** 图片工具栏的「复位」:回到居中、不放大 */
export function IconReset({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 9 8 9" />
    </svg>
  );
}

/** 照片风格/LUT。三条调节轨与「强度」语义一致。 */
export function IconFilter({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="11" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

/** AI 气泡里的星芒(设计稿:不是通用聊天气泡) */
export function IconSparkle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2.5c.4 3.6 2.2 5.6 5.8 6.2-3.6.6-5.4 2.6-5.8 6.2-.4-3.6-2.2-5.6-5.8-6.2 3.6-.6 5.4-2.6 5.8-6.2Z" />
      <path d="M18.6 14.2c.2 1.9 1.1 2.9 3 3.2-1.9.3-2.8 1.3-3 3.2-.2-1.9-1.1-2.9-3-3.2 1.9-.3 2.8-1.3 3-3.2Z" />
    </svg>
  );
}
