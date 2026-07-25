'use client';

/* 极简 toast:未实现功能(AI 对话 / 更多 / 删除)点了给一句明确反馈,
   而不是死按钮。3 秒自动消失,不接管事件(pointer-events:none)。 */

export function MobileToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="mtoast" role="status" aria-live="polite">
      {text}
    </div>
  );
}
