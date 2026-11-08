'use client';

/* AI 生图抽屉(移动端,2026-11-08)。

   补的是桌面 imageGenModal 那块能力:选中图槽 → 写一句描述 → 生成一张新图换上去。
   桌面那套是命令式弹窗 + 内存里的 freeRetriesLeft(免费重来),这里换成受控组件,
   交互与文案与桌面一致:生成中禁用、失败留在原地可重试、免费重来不消失。

   **不落库**:与桌面同一取舍 —— generationId 只在内存,刷新后免费重来就没了。
   之前那次「已经生成出来的图」本身是落盘的(photoId 的字节在 IndexedDB + R2 台账)。 */

import { useEffect, useState } from 'react';
import type { AT } from '@/lib/i18n/pick';
import { ModalHost } from './ModalHost';

export type ImageGenSheetProps = {
  open: boolean;
  aT: AT;
  /** 请求在途:禁用输入与按钮,文案切「生成中…」。 */
  busy: boolean;
  /** 失败的对外文案(服务端 message 或网络错误);成功/未开始为 null。 */
  error: string | null;
  /** 上一笔还剩几次免费重来;>0 时主按钮文案变成「免费再来一张」。 */
  freeRetriesLeft: number;
  onSubmit: (prompt: string) => void;
  onClose: () => void;
};

export function ImageGenSheet({
  open,
  aT,
  busy,
  error,
  freeRetriesLeft,
  onSubmit,
  onClose,
}: ImageGenSheetProps) {
  const [prompt, setPrompt] = useState('');

  // 关闭即清空描述:下次是另一张图,带着上一张的词只会让人误发。
  useEffect(() => {
    if (!open) setPrompt('');
  }, [open]);

  if (!open) return null;

  const canSubmit = prompt.trim().length > 0 && !busy;
  const label = busy
    ? aT('生成中…', 'Generating…')
    : freeRetriesLeft > 0
      ? aT('免费再来一张', 'Try again — free')
      : aT('生成（1 积分）', 'Generate (1 credit)');

  return (
    <ModalHost
      open={open}
      onClose={onClose}
      variant="bottom-sheet"
      cardClassName="mgen-card"
      labelledBy="mImageGenTitle"
      testId="image-gen-modal"
    >
      <div className="mes-head">
        <button type="button" className="mes-cancel" onClick={onClose}>
          {aT('取消', 'Cancel')}
        </button>
        <div className="mes-title" id="mImageGenTitle">
          {aT('AI 生成一张', 'Generate with AI')}
        </div>
        {/* 三栏栅格右侧留空,与换图面板同结构 */}
        <span className="mes-hbtn" aria-hidden="true" />
      </div>

      <div className="mgen-body">
        <textarea
          className="mgen-input"
          rows={3}
          value={prompt}
          disabled={busy}
          placeholder={aT('描述你想要的画面，例如「傍晚的海边，逆光」', 'Describe the image, e.g. "seaside at dusk, backlit"')}
          aria-label={aT('描述画面', 'Describe the image')}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="mgen-hint" data-error={error ? '1' : undefined}>
          {error ?? (busy ? aT('大概十几秒，别关窗口。', 'A few seconds — keep this open.') : '')}
        </p>
        <button
          type="button"
          className="mgen-submit"
          disabled={!canSubmit}
          onClick={() => onSubmit(prompt.trim())}
        >
          {label}
        </button>
      </div>
    </ModalHost>
  );
}
