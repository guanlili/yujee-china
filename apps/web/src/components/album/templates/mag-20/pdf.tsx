import { Text, View } from '@react-pdf/renderer';
import { PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 杂志尾页（PDF 端，与 index.tsx 同一版面）。Logo 字标与设计师署名为固定品牌元素。

export function PdfMag20({ data }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  return (
    <PdfPageShell>
      {/* Logo 品牌字标（固定） */}
      <Text style={{ position: 'absolute', left: 197, top: 100, width: 400, fontSize: 30, fontFamily: PDF_FONTS.serifCn, color: '#1c1b18', textAlign: 'center', letterSpacing: 12, lineHeight: 1 }}>遇己</Text>
      <Text style={{ position: 'absolute', left: 197, top: 150, width: 400, fontSize: 10, fontFamily: PDF_FONTS.garamond, color: '#a09b8e', textAlign: 'center', letterSpacing: 5 }}>YUJEE</Text>

      {/* 收尾图片 */}
      <PdfImage src={d['image1']} style={{ position: 'absolute', left: 197, top: 212, width: 400, height: 460 }} />

      {/* 尾页文案（可编辑槽位） */}
      <Text style={{ position: 'absolute', left: 137, top: 720, width: 520, fontSize: 16, fontFamily: /[一-鿿]/.test(d['title'] || '') ? PDF_FONTS.serifCn : PDF_FONTS.garamond, color: '#5a574f', textAlign: 'center', lineHeight: 1.7 }}>{d['title']}</Text>

      {/* 分隔细线 + 设计师署名（固定） */}
      <View style={{ position: 'absolute', left: 377, top: 980, width: 40, height: 1, backgroundColor: '#a09b8e' }} />
      <Text style={{ position: 'absolute', left: 197, top: 1000, width: 400, fontSize: 13, fontFamily: PDF_FONTS.serifCn, color: '#a09b8e', textAlign: 'center', letterSpacing: 3 }}>设计 · 玉几</Text>
    </PdfPageShell>
  );
}
