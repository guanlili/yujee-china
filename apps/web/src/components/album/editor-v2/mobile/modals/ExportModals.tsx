'use client';

/* 导出相关的四个弹窗:菜单 / 拼图密度 / 进度 / 失败。
   结构与类名逐条对齐桌面成品(EditorPort.tsx 的 exportMenuModal / collageModal /
   exportProgressModal / exportFailModal),样式由同一批规则供给,视觉不会漂移。
   行为(canvas 渲染、上传)后续接线,这里只出 UI 与回调口。 */

import { ModalHost } from './ModalHost';

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/* ── 导出格式菜单 ─────────────────────────────────────────────────────────── */
export function ExportMenuModal({
  open,
  zh,
  onClose,
  onCollage,
  onLive,
  onSinglePages,
  onPdf,
}: {
  open: boolean;
  zh: boolean;
  onClose: () => void;
  /** 四条格式的动作一律必填 —— 可选 + 父层漏传 = 亮着的死按钮(见 click-wiring.test)。 */
  onCollage: () => void;
  onLive: () => void;
  onSinglePages: () => void;
  onPdf: () => void;
}) {
  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="export-sheet"
      labelledBy="mExportMenuTitle"
      testId="export-menu-modal"
    >
      <div className="px-6 pt-5 pb-1">
        <h3 id="mExportMenuTitle" className="font-display text-[18px] font-bold">
          {zh ? '导出' : 'Export'}
        </h3>
        <p className="text-[13px] text-muted mt-1">
          {zh ? '选一种格式导出' : 'Pick a format to export'}
        </p>
      </div>
      <div className="px-5 py-4 flex flex-col gap-2.5">
        <button className="export-opt" onClick={onCollage} data-testid="export-opt-collage">
          <svg {...stroke}>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>{zh ? '多跨页拼图 · JPG' : 'Spread collage · JPG'}</span>
        </button>
        <button className="export-opt" onClick={onLive} data-testid="export-opt-live">
          <svg {...stroke}>
            <rect x="2" y="6" width="14" height="12" rx="2" />
            <path d="m22 8-6 4 6 4V8Z" />
          </svg>
          <span>{zh ? 'Live 图 · MP4' : 'Live · MP4'}</span>
        </button>
        <button className="export-opt" onClick={onSinglePages} data-testid="export-opt-pages">
          <svg {...stroke}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5L9 20" />
          </svg>
          <span>{zh ? '单页 JPG' : 'Single pages · JPG'}</span>
        </button>
        <button className="export-opt" onClick={onPdf} data-testid="export-opt-pdf">
          <svg {...stroke}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
          </svg>
          <span>{zh ? '整本 PDF' : 'Full PDF'}</span>
        </button>
      </div>
      <div className="px-5 pb-5">
        <button className="export-cancel" onClick={onClose}>
          {zh ? '取消' : 'Cancel'}
        </button>
      </div>
    </ModalHost>
  );
}

/* ── 拼图密度:一张图里放几个跨页 ─────────────────────────────────────────── */
export function CollageModal({
  open,
  zh,
  spreadCount,
  density,
  onPickDensity,
  onConfirm,
  onClose,
}: {
  open: boolean;
  zh: boolean;
  spreadCount: number;
  density: number | null;
  onPickDensity: (n: number) => void;
  /** 确认必填 —— 同 PhotoPickerModal:可选 + 父层漏传 = 亮着的死按钮。 */
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="collage-card"
      labelledBy="mCollageTitle"
      testId="collage-modal"
    >
      <button className="collage-close" onClick={onClose} aria-label="close">
        <svg {...stroke}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="px-6 pt-6 text-center">
        <h3 id="mCollageTitle" className="font-display text-[18px] font-bold">
          {zh ? '一张图里放几个跨页?' : 'How many spreads per image?'}
        </h3>
        <p className="text-[13px] text-muted mt-1.5">
          {zh ? '只导出内页(当前 ' : 'Interior spreads only (currently '}
          <span className="font-semibold text-fg">{spreadCount}</span>
          {zh ? ' 个跨页),按选择自动排版' : '), auto-arranged by your choice'}
        </p>
      </div>
      <div className="collage-density px-6 pt-5">
        {[1, 2, 3, 6].map((n) => (
          <button
            key={n}
            className="density-opt"
            data-selected={density === n ? '1' : undefined}
            data-testid={`density-${n}`}
            onClick={() => onPickDensity(n)}
          >
            <span className={`density-wire${n === 6 ? ' density-wire-grid' : ''}`} data-n={n}>
              {Array.from({ length: n }).map((_, i) => (
                <span key={i} className="density-cell" />
              ))}
            </span>
            <span className="density-label">
              {n} {zh ? '个' : ''}
            </span>
          </button>
        ))}
      </div>
      <div className="px-6 py-6">
        <button
          className="collage-confirm"
          data-testid="collage-confirm"
          disabled={density == null}
          onClick={onConfirm}
        >
          {zh ? '确认导出' : 'Export'}
        </button>
      </div>
    </ModalHost>
  );
}

/* ── Live 样式:翻页 / 九宫格 ──────────────────────────────────────────────
   与桌面 nineGridModal 同一步骤(菜单 → 选样式 → 导出),两端心智一致。
   复用拼图那套 collage-* 类名与结构,视觉不额外造一套。 */
export function LiveStyleModal({
  open,
  zh,
  style,
  onPickStyle,
  onConfirm,
  onClose,
}: {
  open: boolean;
  zh: boolean;
  style: 'flip' | 'nine-grid' | null;
  onPickStyle: (s: 'flip' | 'nine-grid') => void;
  /** 确认必填 —— 同 CollageModal:可选 + 父层漏传 = 亮着的死按钮。 */
  onConfirm: () => void;
  onClose: () => void;
}) {
  const options: { id: 'flip' | 'nine-grid'; title: string; copy: string }[] = [
    {
      id: 'flip',
      title: zh ? '翻页 Live' : 'Page-flip Live',
      copy: zh ? '像翻书一样逐页播放' : 'Pages turn like a physical book',
    },
    {
      id: 'nine-grid',
      title: zh ? '九宫格 Live' : 'Nine-grid Live',
      copy: zh ? '每组 9 页整齐切换' : 'Nine pages switch as a neat grid',
    },
  ];
  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="collage-card"
      labelledBy="mLiveStyleTitle"
      testId="live-style-modal"
    >
      <button className="collage-close" onClick={onClose} aria-label="close">
        <svg {...stroke}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="px-6 pt-6 text-center">
        <h3 id="mLiveStyleTitle" className="font-display text-[18px] font-bold">
          {zh ? 'Live 图' : 'Live video'}
        </h3>
        <p className="text-[13px] text-muted mt-1.5">
          {zh ? '选一种样式,导出一段 Live 视频,可直接发社交平台。' : 'Pick a style and export a Live video you can post anywhere.'}
        </p>
      </div>
      {/* 类名逐条复用桌面那套(nine-grid-choice / motion-*),不另造一份 ——
          ModalHost 就是为吃桌面样式表而存在的(见其抬头),所以这里零新增 CSS,
          两端的示意图连翻页/网格动画都是同一批 keyframes,不会漂移。 */}
      <div className="nine-grid-choice px-6 pt-5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={style === o.id ? 'selected' : undefined}
            data-testid={`live-style-${o.id}`}
            aria-pressed={style === o.id}
            onClick={() => onPickStyle(o.id)}
          >
            <span className={`motion-example motion-example-${o.id === 'flip' ? 'flip' : 'grid'}`} aria-hidden="true">
              {o.id === 'flip' ? (
                <span className="motion-book">
                  <span className="motion-page motion-page-left" />
                  <span className="motion-page motion-page-right" />
                  <span className="motion-page motion-page-turn" />
                </span>
              ) : (
                <span className="motion-grid">
                  {Array.from({ length: 9 }).map((_, i) => <span key={i} />)}
                </span>
              )}
            </span>
            <span className="motion-option-title">{o.title}</span>
            <span className="motion-option-copy">{o.copy}</span>
          </button>
        ))}
      </div>
      <div className="px-6 py-6">
        <button
          className="collage-confirm"
          data-testid="live-style-confirm"
          disabled={style == null}
          onClick={onConfirm}
        >
          {zh ? '继续导出' : 'Continue'}
        </button>
      </div>
    </ModalHost>
  );
}

/* ── 导出进度(渲染期间不可关闭) ──────────────────────────────────────────── */
export function ExportProgressModal({
  open,
  zh,
  label,
  percent,
}: {
  open: boolean;
  zh: boolean;
  label: string;
  percent: number;
}) {
  return (
    <ModalHost
      open={open}
      onClose={() => {}} // 渲染中不可关
      cardClassName="export-progress-card"
      testId="export-progress"
    >
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-[15px] font-semibold">
            {zh ? '正在导出…' : 'Exporting…'}
          </h3>
          <span className="text-[13px] text-muted tabular-nums">{label}</span>
        </div>
        <div className="exp-bar">
          <div className="exp-bar-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
        <p className="text-[12px] text-muted mt-2.5">
          {zh ? '生成中,请稍候,别关闭页面' : 'Generating — please keep this page open'}
        </p>
      </div>
    </ModalHost>
  );
}

/* ── 导出已生成:用一次新的明确点击触发系统分享/下载 ──────────────────────── */
export function ExportReadyModal({
  open,
  zh,
  label,
  onClose,
  onSave,
}: {
  open: boolean;
  zh: boolean;
  label: string;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <ModalHost open={open} onClose={onClose} labelledBy="mExportReadyTitle" testId="export-ready-modal">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h3 id="mExportReadyTitle" className="font-display text-[17px] font-bold">
          {zh ? `${label}已生成` : `${label} is ready`}
        </h3>
        <p className="text-[13px] text-muted mt-3 leading-relaxed">
          {zh
            ? '点击“保存 / 分享”完成保存，手机会打开系统分享面板。'
            : 'Tap “Save / Share” to finish. Your phone will open the system share sheet.'}
        </p>
      </div>
      <div className="px-6 py-4 shrink-0 flex items-center justify-end gap-2">
        <button
          className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg"
          onClick={onClose}
        >
          {zh ? '稍后' : 'Later'}
        </button>
        <span className="btn-glow">
          <button
            className="px-5 py-2.5 rounded-pill text-[13px] font-semibold bg-fg text-white transition-transform hover:-translate-y-px"
            data-testid="export-ready-save"
            onClick={onSave}
          >
            {zh ? '保存 / 分享' : 'Save / Share'}
          </button>
        </span>
      </div>
    </ModalHost>
  );
}

/* ── 导出失败安抚 ─────────────────────────────────────────────────────────── */
export function ExportFailModal({
  open,
  zh,
  onClose,
  onRetry,
}: {
  open: boolean;
  zh: boolean;
  onClose: () => void;
  /** 「再试一次」必填 —— 可选就会漏传成死按钮(见 click-wiring.test)。 */
  onRetry: () => void;
}) {
  return (
    <ModalHost open={open} onClose={onClose} labelledBy="mExportFailTitle" testId="export-fail-modal">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-bg text-accent">
            <svg {...stroke} className="w-5 h-5">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </span>
          <h3 id="mExportFailTitle" className="font-display text-[17px] font-bold">
            {zh ? '导出遇到了点小麻烦' : 'Export ran into trouble'}
          </h3>
        </div>
        <p className="text-[13px] text-muted mt-3 leading-relaxed">
          {zh
            ? '我们试了几次都没能生成你的 PDF,可能是网络不太稳。你的纪念册内容都安全保存着,稍后再点一次「导出 PDF」通常就好了。'
            : 'We tried a few times but could not generate your PDF — the network may be unstable. Your album is safely saved; try “Export PDF” again later.'}
        </p>
      </div>
      <div className="px-6 py-4 shrink-0 flex items-center justify-end gap-2">
        <button
          className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg"
          onClick={onClose}
        >
          {zh ? '知道了' : 'Got it'}
        </button>
        <span className="btn-glow">
          <button
            className="px-5 py-2.5 rounded-pill text-[13px] font-semibold bg-fg text-white transition-transform hover:-translate-y-px"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,.12)' }}
            onClick={onRetry}
          >
            {zh ? '再试一次' : 'Try again'}
          </button>
        </span>
      </div>
    </ModalHost>
  );
}
