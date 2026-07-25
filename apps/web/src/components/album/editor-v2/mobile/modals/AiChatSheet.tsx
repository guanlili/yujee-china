'use client';

/* AI 对话弹框(移动端)—— 浅色 bottom sheet + 产品小水母。

   配色对齐桌面 ≤767 的对话面板(.pane-chat-col/.pane-right):浅底卡片 + 压暗遮罩。
   **黑色只属于收起时那枚浮标**(.mai,对齐桌面 .chat-fold-expand);弹窗不是黑的。

   为什么不直接挂桌面 ChatPanel:它深度依赖桌面画布协调器(ChatCoordinatorContext,
   由 EditorBook 挂载时填充),移动端这棵独立树没有那套上下文,整体挂进来会炸。
   所以这里是移动端自己的对话外壳,复用产品小水母形象(jellyfish-icon.png,与桌面
   休息态 await-jelly 同一素材)。真正的 AI 收发是后续切片(3e)接;现在输入框可打字,
   发送先给反馈。 */

import { useState } from 'react';

export type AiChatSheetProps = {
  open: boolean;
  zh: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
};

export function AiChatSheet({ open, zh, onSend, onClose }: AiChatSheetProps) {
  const [text, setText] = useState('');
  if (!open) return null;

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div
      className="mai-sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mai-sheet" role="dialog" aria-modal="true" aria-label={zh ? 'AI 助手' : 'AI assistant'}>
        <div className="mai-sheet-grab" aria-hidden="true">
          <span />
        </div>
        <div className="mai-sheet-head">
          <img className="mai-sheet-jelly" src="/jellyfish-icon.png" alt="" />
          <div className="mai-sheet-titles">
            <div className="mai-sheet-title">{zh ? '遇己' : 'Yujee'}</div>
            <div className="mai-sheet-sub">{zh ? '和我聊聊这段回忆' : "Tell me about this memory"}</div>
          </div>
          <button type="button" className="mai-sheet-close" onClick={onClose} aria-label={zh ? '收起' : 'Close'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mai-sheet-body">
          <div className="mai-msg">
            {zh
              ? '想让这段回忆更完整,可以告诉我那天的天气、和谁同行、当时的心情,我会把它们融进文字里。'
              : "Tell me the weather, who you were with, how you felt — I'll weave it into the words."}
          </div>
        </div>

        <div className="mai-sheet-composer">
          <textarea
            className="mai-sheet-input"
            rows={1}
            placeholder={zh ? '和我说说…' : 'Say something…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="mai-sheet-send"
            disabled={!text.trim()}
            onClick={send}
            aria-label={zh ? '发送' : 'Send'}
          >
            {/* 上箭头,逐条照搬桌面 ChatPanel 的 .send-btn 图标(strokeWidth 2 / 17px)。
                原先用的纸飞机在 18px 描边下糊成一个「N」,而且桌面也不是那个图标。 */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
