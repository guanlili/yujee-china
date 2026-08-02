'use client';

/* AI 对话弹框(移动端)—— 浅色 bottom sheet + 产品小水母。

   配色对齐桌面 ≤767 的对话面板(.pane-chat-col/.pane-right):浅底卡片 + 压暗遮罩。
   **黑色只属于收起时那枚浮标**(.mai,对齐桌面 .chat-fold-expand);弹窗不是黑的。

   为什么不直接挂桌面 ChatPanel:它深度依赖桌面画布协调器(ChatCoordinatorContext,
   由 EditorBook 挂载时填充),移动端这棵独立树没有那套上下文,整体挂进来会炸。
   所以这里是移动端自己的对话外壳,复用产品小水母形象(jellyfish-icon.png,与桌面
   休息态 await-jelly 同一素材)。真正的 AI 收发是后续切片(3e)接;现在输入框可打字,
   发送先给反馈。 */

import { useEffect, useRef, useState } from 'react';

import { renderMarkdownSafe } from '@/lib/markdown/render';

import type { DesignChangeCategory } from '../../chat-history';
import type { ChatMessage, ChatStatus } from '../use-design-chat';

/** 「已更新」条的类别标签。与桌面 DESIGN_CHANGE_LABEL 同一批词。 */
const CHANGE_LABEL: Record<DesignChangeCategory, [string, string]> = {
  fonts: ['字体', 'Fonts'],
  colors: ['颜色', 'Colors'],
  pages: ['页面', 'Pages'],
  order: ['页序', 'Order'],
};

export type AiChatSheetProps = {
  open: boolean;
  zh: boolean;
  /** 这一册的对话(含历史回放)。 */
  messages: ChatMessage[];
  /** 在跑时给一句「正在…」;出错给一句人话。 */
  status: ChatStatus;
  onSend: (text: string) => void;
  onClose: () => void;
};

/* 高度口径逐条对齐桌面(ChatPanel 的 onSheetDown + editor-port.css 的 .pane-chat-col):
   底边钉死、高度可拖,下限 150px、上限 90vh。默认高度用户定的 50%(线上那份是 46vh)。 */
const MIN_H = 150;
const MAX_VH = 0.9;
/** 位移在此以内算「轻点把手」= 收起(与桌面同一语义)。 */
const TAP_SLOP = 6;
/** 拖到明显低于下限 → 意图是整个收起,不是留在最小高度。 */
const COLLAPSE_SLOP = 28;

export function AiChatSheet({ open, zh, messages, status, onSend, onClose }: AiChatSheetProps) {
  const [text, setText] = useState('');
  // null = 没手动拖过,走 CSS 的默认 75vh。拖出来的高度记住,下次展开还是它(同桌面)。
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 新消息/状态变化时滚到底 —— 否则回复到了却停在上面,看着像没反应。
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, status]);
  const drag = useRef<{ startY: number; startH: number; dy: number; collapse: boolean } | null>(null);

  if (!open) return null;

  const send = () => {
    const t = text.trim();
    if (!t || status.kind === 'busy') return;
    onSend(t);
    setText('');
  };

  // 拖把手改高度。用 setPointerCapture 把后续 move/up 都收到把手上 —— 不必往 window
  // 挂监听,手指滑出把手也不会断。
  const onGrabDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    const el = sheetRef.current;
    if (!el) return;
    e.preventDefault();
    drag.current = {
      startY: e.clientY,
      startH: el.getBoundingClientRect().height,
      dy: 0,
      collapse: false,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onGrabMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.dy = e.clientY - d.startY;
    const raw = d.startH - d.dy; // 底边钉死:下拉(dy>0)高度变小
    d.collapse = raw < MIN_H - COLLAPSE_SLOP;
    setHeight(Math.min(window.innerHeight * MAX_VH, Math.max(MIN_H, raw)));
  };

  const onGrabUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (Math.abs(d.dy) <= TAP_SLOP) {
      setHeight(d.startH); // 轻点把手 = 收起,高度留着,下次展开还是这么高
      onClose();
    } else if (d.collapse) {
      setHeight(null); // 拖没了 = 收起并回落默认 75vh
      onClose();
    }
  };

  return (
    <div
      className="mai-sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="mai-sheet"
        data-dragging={dragging ? '1' : undefined}
        style={height != null ? { height } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={zh ? 'AI 助手' : 'AI assistant'}
      >
        <div
          className="mai-sheet-grab"
          role="separator"
          aria-orientation="horizontal"
          aria-label={zh ? '拖动调整高度,轻点收起' : 'Drag to resize, tap to collapse'}
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
        >
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

        <div className="mai-sheet-body" ref={bodyRef}>
          {messages.length === 0 && (
            <div className="mai-msg">
              {zh
                ? '想让这段回忆更完整,可以告诉我那天的天气、和谁同行、当时的心情,我会把它们融进文字里。'
                : "Tell me the weather, who you were with, how you felt — I'll weave it into the words."}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id}>
              {/* 「已更新」条:与桌面回放同序,贴在这条 AI 回复之前。 */}
              {m.changes.length > 0 && (
                <div className="mai-msg-changes">
                  <span className="mai-changes-kicker">{zh ? '已更新' : 'Updated'}</span>
                  {m.changes.map((c) => (
                    <span key={c} className="mai-changes-tag">
                      {zh ? CHANGE_LABEL[c][0] : CHANGE_LABEL[c][1]}
                    </span>
                  ))}
                </div>
              )}
              {/* AI 文本走 markdown(renderMarkdownSafe 已消毒,与桌面同一个函数);
                  用户气泡保持纯文本 —— 用户输入永远不进 innerHTML。 */}
              {m.role === 'assistant' ? (
                <div
                  className="mai-msg"
                  data-role={m.role}
                  dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(m.text) }}
                />
              ) : (
                <div className="mai-msg" data-role={m.role}>
                  {m.text}
                </div>
              )}
            </div>
          ))}
          {status.kind === 'busy' && (
            <div className="mai-msg mai-msg-status" aria-live="polite">
              <img className="mai-think-jelly" src="/jellyfish-icon.png" alt="" />
              {status.label}
            </div>
          )}
          {status.kind === 'error' && (
            <div className="mai-msg mai-msg-error" role="alert">
              {status.message}
            </div>
          )}
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
            disabled={!text.trim() || status.kind === 'busy'}
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
