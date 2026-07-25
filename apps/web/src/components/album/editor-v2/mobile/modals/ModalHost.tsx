'use client';

/* ════════════════════════════════════════════════════════════════════════════
   ModalHost —— 让移动端直接用上桌面那批成品弹窗的宿主层。

   桌面弹窗的样式(.modal-overlay / .modal-card / .export-sheet / .bbg-* / .mes-*)
   共 165 条规则,选择器全带 `.editor-port` 前缀。移动端根节点是 `.mobile-editor`,
   一条都命中不了。

   与其复制 CSS(会漂移)或改桌面样式表(有风险),不如让弹窗**挂在一个带 editor-port
   类的宿主里** —— 规则原样命中,视觉与网页端天然一致,editor-port.css 一行不动。
   宿主自身的底色/尺寸由 .mobile-modal-host 中和掉(见 mobile-editor.css)。

   注意:这不违反「两棵树不共用 DOM」—— 共用的是**样式表**(设计系统那一层),
   节点仍由移动端自己渲染、自己拥有。
   ════════════════════════════════════════════════════════════════════════════ */

import type { ReactNode } from 'react';

export type ModalHostProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 传给 .modal-card 的额外类(如 export-sheet / board-bg-sheet)。 */
  cardClassName?: string;
  labelledBy?: string;
  testId?: string;
};

export function ModalHost({
  open,
  onClose,
  children,
  cardClassName = '',
  labelledBy,
  testId,
}: ModalHostProps) {
  if (!open) return null;
  return (
    <div className="editor-port mobile-modal-host">
      {/* .open 是桌面那套弹窗的显隐约定(JS 加类),这里由 React 的挂载与否决定,
          挂上就直接带 open,过渡动画照旧。 */}
      <div
        className="modal-overlay open"
        onClick={(e) => {
          // 点遮罩关闭 —— 对齐桌面的 data-overlay-close 行为
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className={`modal-card ${cardClassName}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-testid={testId}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
