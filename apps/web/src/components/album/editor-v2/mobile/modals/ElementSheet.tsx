'use client';

/* 移动端元素编辑 sheet(mes)—— 结构与类名逐条对齐桌面成品(EditorPort.tsx 的
   mesOverlay/mesCard)。这套本来就是为移动端做的:三段头(取消 / 标题 / 完成)、
   可拖把手、2/3 高卡片,已经过一轮优化(字号步进胶囊、8 常用色漏出、字体 chips、
   textarea 16px 防 iOS 聚焦缩放),交互语言继续沿用。

   语义(与桌面一致):取消 = 快照还原,完成 = 落库重绘。
   body 是插槽 —— 文字/图片各自的控件由调用方塞进来。 */

import type { ReactNode } from 'react';

export type ElementSheetProps = {
  open: boolean;
  zh: boolean;
  title: string;
  children: ReactNode;
  /** 卡片以上的区域是否放行手势(默认不放行 = 普通模态)。
   *
   *  图片编辑要的是「面板开着,同时用手指在页面上拖动/捏合那张图」。而 .mes-overlay 是
   *  inset:0 铺满整屏的,不放行的话手指永远碰不到图 —— 面板一开图就锁死了。
   *  放行只作用在**遮罩**上,卡片自身仍然 pointer-events:auto,所以取消/完成照常可点
   *  (那次「弹窗关不掉」的事故是宿主整体 pointer-events:none + 类名放行名单,不是这个)。 */
  passThrough?: boolean;
  /** 取消:放弃本次改动(快照还原)。 */
  onCancel: () => void;
  /** 完成:落库并重绘。 */
  onDone: () => void;
};

export function ElementSheet({
  open,
  zh,
  title,
  children,
  passThrough,
  onCancel,
  onDone,
}: ElementSheetProps) {
  // 关着就不渲染宿主 —— 宿主存在即接管事件(见 mobile-editor.css 的说明)。
  if (!open) return null;
  return (
    <div className="editor-port mobile-modal-host">
      <div
        className="mes-overlay"
        data-open="1"
        data-passthrough={passThrough ? '1' : undefined}
        onClick={(e) => {
          // 点遮罩 = 取消,与桌面弹窗一致;点卡片内部不关。
          // 放行模式下遮罩收不到事件,这条自然不触发(取消走卡片上的按钮)。
          if (e.target === e.currentTarget) onCancel();
        }}
      >
        <div
          className="mes-card"
          role="dialog"
          aria-modal="true"
          aria-label={zh ? '编辑' : 'Edit'}
        >
          <div className="mes-grab" aria-hidden="true">
            <span />
          </div>
          <div className="mes-head">
            <button type="button" className="mes-hbtn mes-cancel" onClick={onCancel}>
              {zh ? '取消' : 'Cancel'}
            </button>
            <span className="mes-title">{title}</span>
            <button type="button" className="mes-hbtn mes-done" onClick={onDone}>
              {zh ? '完成' : 'Done'}
            </button>
          </div>
          <div className="mes-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
