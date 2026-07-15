'use client';

import { useEffect, useRef } from 'react';
import { fitTextBoxes } from './page-html-dom';

// dangerouslySetInnerHTML + 挂载后跑 fit-text pass(固定高度文字槽字号自适应)。
// FlipBook / PagePreview 等 React 注入点统一用它,和 EditorPort paintEl、栅格
// PDF 离屏 host 保持同一展示行为。字体异步就绪会改变换行,就绪后再跑一遍。
// fit=false(缩略图等几十 px 的表面)跳过整个 pass:字号自适应在那个尺度不可见,
// 省掉的是每格一串强制重排。
export function FittedPageHtml({ html, fit = true }: { html: string; fit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fit) return;
    const el = ref.current;
    if (!el) return;
    fitTextBoxes(el);
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled && ref.current) fitTextBoxes(ref.current);
    });
    return () => {
      cancelled = true;
    };
  }, [html, fit]);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
