import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';

// 内页 · 满版大图叠字（category: interior，1 图）。来自 A4-8 (node 11:359)。
// 一张近乎铺满整页的满版背景大图（溢出画布部分被最外层 overflow:hidden 裁掉）；
// 其上居中叠一块半透明白色面板（色块，非图片槽），面板里是居中白色大字地名标题；
// 左下角一行浅色小图注。文字渲染在图之后 → z 顺序在图上层。
//（595×842 → ×1.3344 → 794×1123）。
// 全套深墨文字色 INK = #1c1b18（图注用其 70% 透明），标题为白色叠在面板上。

export function WebMag36({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', 'title');
  const explainTheme = resolveThemeCarrier(data, 'explain', 'explain');
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 满版背景大图（先渲染，溢出部分被裁；文字 / 面板叠其上） */}
      <WebImage src={d['image']} style={{ position: 'absolute', left: 0, top: 0, width: 831, height: 1123, objectFit: 'cover' }} position={imagePos?.['image']} slotId="image" />

      {/* 居中半透明白色面板（色块，非图片槽） */}
      <div style={{ position: 'absolute', left: 72, top: 436, width: 650, height: 251, background: 'rgba(255,255,255,0.55)' }} />

      {/* 居中大字标题（叠在面板上方） */}
      <div style={{ position: 'absolute', left: 156, top: 492, width: 483, height: 157, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: titleTheme.webFontFamily, fontWeight: 700, fontSize: 64, lineHeight: 1.05, color: titleTheme.accentColor ?? '#FFFFFF', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>

      {/* 左下角浅色小图注 */}
      <div style={{ position: 'absolute', left: 72, top: 540, width: 320, fontFamily: explainTheme.webFontFamily, fontWeight: 400, fontSize: 14, lineHeight: 1.4, color: explainTheme.accentColor ?? 'rgba(28,27,24,0.7)', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['explain']}</div>
    </div>
  );
}
