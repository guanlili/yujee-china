import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 留白收束内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。来自 A4-10 (node 11:456)。
// 白底覆盖 Shell 暖纸色；下半页方形大图，图上方左侧闭合手记（正文），右上角倾斜装饰短句（-22°）。
// 文字含中文时切到 serifCn（Noto SC）避免豆腐块，纯英文走 interEn（Inter，与 web 一致）。
// 全套文字 #1c1b18。倾斜句用 @react-pdf 的 transform rotate + transformOrigin 'left top' 近似 web。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag37({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyFont = hasCjk(d['body']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  const decorFont = hasCjk(d['decor']) ? PDF_FONTS.serifCn : PDF_FONTS.interEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 下半页方形大图 */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 119, top: 562, width: 532, height: 512 }} position={imagePos?.['image']} />

      {/* 图上方左侧闭合手记（正文） */}
      <Text style={{ position: 'absolute', left: 133, top: 426, width: 252, fontFamily: bodyFont, fontSize: 21, lineHeight: 1.35, color: INK }}>{d['body']}</Text>

      {/* 右上角倾斜装饰短句（-22°，variableDecor） */}
      <View style={{ position: 'absolute', left: 438, top: 387, transform: 'rotate(-22deg)', transformOrigin: 'left top' }}>
        <Text style={{ width: 280, fontFamily: decorFont, fontSize: 21, lineHeight: 1.35, color: INK }}>{d['decor']}</Text>
      </View>
    </PdfPageShell>
  );
}
