import type { TemplateRenderProps } from '../types';
import { COLORS, PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';

// @studio-canvas:v1 {"slot":"interior","scene":"record","elements":[{"id":"image1","kind":"image","x":97,"y":110,"w":600,"h":620,"fit":"cover"},{"id":"title","kind":"text","x":97,"y":760,"w":600,"h":70,"text":"标题","fontSize":44,"font":"serifEn","align":"left","role":"title","lang":"user","maxChars":20}]}
// 此文件由模板操作台的画布生成。可在画布里再次打开编辑（spec 见上方注释）。

export function WebMag21({ data }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: COLORS.paper, overflow: 'hidden' }}>
      <WebImage src={d['image1']} style={{ position: 'absolute', left: 97, top: 110, width: 600, height: 620, objectFit: 'cover' }} />
      <div style={{ position: 'absolute', left: 97, top: 760, width: 600, height: 70, fontSize: 44, fontFamily: WEB_FONTS.serifEn, color: COLORS.ink, textAlign: 'left', lineHeight: 1.4, whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{d['title']}</div>
    </div>
  );
}
