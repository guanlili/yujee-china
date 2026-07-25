'use client';

/* 照片选择弹窗 —— 结构与类名逐条对齐桌面成品(EditorPort.tsx 的 photoModal)。
   移动端用途:编辑态「图片 → 换照片」。照片只存在浏览器本地(invariant 1),
   缩略走 thumb 档,与桌面同一分级。 */

import { ModalHost } from './ModalHost';

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export type PhotoPickerModalProps = {
  open: boolean;
  zh: boolean;
  title?: string;
  subtitle?: string;
  /** 可选照片:id + 缩略图 URL。 */
  photos: { id: string; url?: string }[];
  selectedId?: string | null;
  confirmLabel?: string;
  onSelect: (photoId: string) => void;
  onUpload?: (file: File) => void;
  /** 确认必填 —— 曾因它是可选、父层漏传,导致选中照片后按钮亮着却点不动(死按钮)。 */
  onConfirm: () => void;
  onClose: () => void;
};

export function PhotoPickerModal({
  open,
  zh,
  title,
  subtitle,
  photos,
  selectedId,
  confirmLabel,
  onSelect,
  onUpload,
  onConfirm,
  onClose,
}: PhotoPickerModalProps) {
  return (
    <ModalHost open={open} onClose={onClose} testId="photo-picker-modal">
      <div className="px-6 pt-5 pb-4 border-b border-bdsoft shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[17px] font-bold">
            {title ?? (zh ? '选择照片' : 'Choose photos')}
          </h3>
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-bg hover:text-fg transition-colors"
            onClick={onClose}
            aria-label="close"
          >
            <svg {...stroke} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {subtitle ? <p className="text-[12.5px] text-muted mt-1">{subtitle}</p> : null}
      </div>

      <div className="px-6 py-5 overflow-y-auto flex-1">
        <div className="pick-grid">
          <label className="pick-upload">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && onUpload) onUpload(f);
                e.target.value = '';
              }}
            />
            <svg {...stroke} className="w-5 h-5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-[10.5px] leading-tight">{zh ? '上传照片' : 'Upload'}</span>
          </label>
          {photos.map((p) => (
            <button
              key={p.id}
              className="pick-item"
              data-selected={p.id === selectedId ? '1' : undefined}
              aria-label={p.id}
              style={p.url ? { backgroundImage: `url("${p.url}")` } : undefined}
              onClick={() => onSelect(p.id)}
            />
          ))}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-bdsoft shrink-0 flex items-center justify-end gap-2">
        <button
          className="px-5 py-2.5 rounded-pill text-[13px] font-medium text-fg2 border border-bd transition-colors hover:bg-bg"
          onClick={onClose}
        >
          {zh ? '取消' : 'Cancel'}
        </button>
        <span className="btn-glow">
          <button
            className="px-5 py-2.5 rounded-pill text-[13px] font-semibold bg-fg text-white transition-transform hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,.12)' }}
            disabled={!selectedId}
            onClick={onConfirm}
          >
            {confirmLabel ?? (zh ? '换成这张' : 'Use this photo')}
          </button>
        </span>
      </div>
    </ModalHost>
  );
}
