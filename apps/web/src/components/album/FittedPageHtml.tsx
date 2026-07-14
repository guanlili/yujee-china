'use client';

import { useEffect, useRef } from 'react';
import { fitTextBoxes } from './page-html-dom';

// dangerouslySetInnerHTML + 挂载后跑 fit-text pass(固定高度文字槽字号自适应)。
// FlipBook / PagePreview 等 React 注入点统一用它,和 EditorPort paintEl、栅格
// PDF 离屏 host 保持同一展示行为。字体异步就绪会改变换行,就绪后再跑一遍。
export function FittedPageHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [html]);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
