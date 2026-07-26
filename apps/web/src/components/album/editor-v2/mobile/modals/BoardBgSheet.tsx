'use client';

/* 画板垫底背景弹窗 —— 结构与类名逐条对齐桌面成品(EditorPort.tsx 的 boardBgModal),
   所以样式由同一批 .bbg-* 规则供给,视觉不可能漂移;这里只把行为换成 React 驱动。

   功能与桌面一致:纯色预设 / 无背景 / 图片预设 / 上传本地图。
   上传图只存本地(IndexedDB),换设备解析不到则回落无背景 —— 与桌面同一取舍。 */

import { useRef } from 'react';

import {
  COLOR_PRESETS,
  IMAGE_PRESETS,
  presetImageUrl,
  type BoardBackground,
} from '@/lib/board-bg/presets';
import { IMAGE_INPUT_ACCEPT } from '@/lib/photo/heic';
import { ModalHost } from './ModalHost';
import { ColorPicker } from './ColorPicker';

export type BoardBgSheetProps = {
  open: boolean;
  zh: boolean;
  current: BoardBackground | null;
  onClose: () => void;
  onPick: (bg: BoardBackground | null) => void;
  /** 'main' = 色板 + 图片;'color' = 完整取色器(与文字/页面底色同一个组件)。 */
  view?: 'main' | 'color';
  onOpenPicker?: () => void;
  onBackToMain?: () => void;
  /** 上传本地图:调用方负责存进 photoStore 并回传 key。 */
  onUpload: (file: File) => void;
};

export function BoardBgSheet({
  open,
  zh,
  current,
  onClose,
  onPick,
  view = 'main',
  onOpenPicker,
  onBackToMain,
  onUpload,
}: BoardBgSheetProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="board-bg-sheet"
      labelledBy="mBoardBgTitle"
      testId="board-bg-modal"
    >
      <div className="board-bg-head">
        <h3 id="mBoardBgTitle" className="font-display text-[17px] font-bold">
          {zh ? '垫底背景' : 'Board background'}
        </h3>
        <button className="board-bg-close" onClick={onClose} aria-label="close">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {view === 'color' ? (
        <div className="board-bg-body" data-bbg-view="color">
          <button type="button" className="mes-back" onClick={onBackToMain}>
            ‹ {zh ? '返回' : 'Back'}
          </button>
          <ColorPicker
            zh={zh}
            value={current?.kind === 'color' ? current.color : null}
            withAlpha={false}
            onChange={(css) => onPick({ kind: 'color', color: css })}
          />
        </div>
      ) : (
      <div className="board-bg-body" data-bbg-view="main">
        <div className="bbg-main">
          <div className="bbg-swatches">
            <button
              className="bbg-swatch bbg-none"
              data-testid="bbg-none"
              data-selected={current == null ? '1' : undefined}
              title={zh ? '无背景' : 'None'}
              aria-label={zh ? '无背景' : 'None'}
              onClick={() => onPick(null)}
            />
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                className="bbg-swatch"
                style={{ background: c }}
                aria-label={c}
                title={c}
                data-selected={
                  current?.kind === 'color' && current.color === c ? '1' : undefined
                }
                onClick={() => onPick({ kind: 'color', color: c })}
              />
            ))}
            {/* 自定义取色:与文字/书页底色同一个取色器(桌面也是「一个取色器服务三处」) */}
            {onOpenPicker && (
              <button
                className="bbg-swatch mes-sw-more"
                data-testid="bbg-more"
                title={zh ? '更多颜色' : 'More colors'}
                aria-label={zh ? '更多颜色' : 'More colors'}
                onClick={onOpenPicker}
              />
            )}
          </div>

          <p className="bbg-section-label">{zh ? '图片' : 'Images'}</p>
          <div className="bbg-images">
            {IMAGE_PRESETS.map((p) => (
              <button
                key={p.id}
                className="bbg-image"
                aria-label={p.label}
                data-selected={
                  current?.kind === 'preset' && current.presetId === p.id ? '1' : undefined
                }
                style={{ backgroundImage: `url("${presetImageUrl(p.id)}")` }}
                onClick={() => onPick({ kind: 'preset', presetId: p.id })}
              />
            ))}
            {/* 上传自己的图当垫底背景(只存本地) */}
            <label className="bbg-image bbg-upload" title={zh ? '上传图片' : 'Upload image'}>
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_INPUT_ACCEPT}
                className="hidden"
                aria-label={zh ? '上传图片' : 'Upload image'}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = ''; // 同一张图可以再选一次
                }}
              />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </label>
          </div>
        </div>
      </div>
      )}
    </ModalHost>
  );
}
