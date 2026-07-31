'use client';

import { useRef } from 'react';
import { useFitTextBoxes } from './use-fit-text-boxes';

// dangerouslySetInnerHTML + 挂载后跑 fit-text pass(固定高度文字槽字号自适应)。
// FlipBook / PagePreview 等 React 注入点统一用它,和 EditorPort paintEl、栅格
// PDF 离屏 host、移动端 MobileEditor/EditView 保持同一展示行为 —— 那一步本身住在
// use-fit-text-boxes(含「字体到货后再收一次」)。
// fit=false(缩略图等几十 px 的表面)跳过整个 pass:字号自适应在那个尺度不可见,
// 省掉的是每格一串强制重排。
export function FittedPageHtml({ html, fit = true }: { html: string; fit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useFitTextBoxes(ref, fit);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
