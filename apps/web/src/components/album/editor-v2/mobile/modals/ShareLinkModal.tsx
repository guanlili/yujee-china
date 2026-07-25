'use client';

/* 分享链接弹窗,两步(与桌面同一交互):
   ① 说明「生成会上传照片快照,否则对方看不到」+ 确认;
   ② 照片传齐、链接生成后换成链接 + 复制。
   结构与类名逐条对齐桌面成品(EditorPort.tsx 的 shareLinkModal)。 */

import { ModalHost } from './ModalHost';

export type ShareLinkModalProps = {
  open: boolean;
  zh: boolean;
  /** 已生成的链接;null = 还在第一步(待确认上传)。 */
  link: string | null;
  /** 上传/生成进行中:确认按钮禁用。 */
  busy?: boolean;
  hint?: string;
  /** 动作必填 —— 可选 + 父层漏传 = 亮着却点不动的死按钮(见 click-wiring.test)。 */
  onConfirm: () => void;
  /** 复制只在第二步(link != null)出现;链接是父层给的,所以它和 link 一起必填。 */
  onCopy: () => void;
  onClose: () => void;
};

export function ShareLinkModal({
  open,
  zh,
  link,
  busy,
  hint,
  onConfirm,
  onCopy,
  onClose,
}: ShareLinkModalProps) {
  return (
    <ModalHost
      open={open}
      onClose={onClose}
      cardClassName="export-sheet"
      labelledBy="mShareLinkTitle"
      testId="share-link-modal"
    >
      <div className="px-6 pt-5 pb-1">
        <h3 id="mShareLinkTitle" className="font-display text-[18px] font-bold">
          {zh ? '分享链接' : 'Share link'}
        </h3>
        <p className="text-[13px] text-muted mt-1">
          {zh
            ? '生成链接分享给朋友,免注册即可查看。'
            : 'Create a link to share with friends — no sign-up to view.'}
        </p>
      </div>
      <div className="px-5 py-3">
        {link == null ? (
          <div>
            <p className="text-[13px] leading-relaxed text-[var(--fg)]">
              {zh
                ? '生成链接会上传照片,朋友才能看到。'
                : 'Creating the link uploads your photos so friends can see them.'}
            </p>
            <button
              className="mt-3 w-full rounded-lg bg-[var(--fg)] px-4 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="share-link-confirm"
              disabled={busy}
              onClick={onConfirm}
            >
              {zh ? '上传照片并生成链接' : 'Upload photos & create link'}
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[var(--bg)] px-3 py-2 text-[13px] text-[var(--fg)]"
              />
              <button
                className="rounded-lg bg-[var(--fg)] px-4 py-2 text-[13px] font-semibold text-white"
                onClick={onCopy}
              >
                {zh ? '复制' : 'Copy'}
              </button>
            </div>
          </div>
        )}
        {hint ? <p className="text-[12px] text-muted mt-2">{hint}</p> : null}
      </div>
      <div className="px-5 pb-5">
        <button className="export-cancel" onClick={onClose}>
          {zh ? '关闭' : 'Close'}
        </button>
      </div>
    </ModalHost>
  );
}
