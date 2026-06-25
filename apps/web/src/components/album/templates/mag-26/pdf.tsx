import { Text, View } from '@react-pdf/renderer';
import { PAGE, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 内页 · 竖排标题图文页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。白底覆盖 Shell 暖纸色；
// 竖排标题（lang=user）按有无中文在 sansEn(英) 与 Noto Sans SC(中) 间切换，避免中文豆腐块；
// 正文走 sansCn、导语走 serifCn、竖排英文装饰走 serifCn（替代 Song Myung）。
// 竖排文字用 @react-pdf transform rotate(-90deg) 近似 web。引号 / 细线固定、不进契约。

const INK = '#1c1b18';
const hasCjk = (s: string | undefined) => /[一-鿿]/.test(s || '');

export function PdfMag26({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleFont = hasCjk(d['title']) ? PDF_FONTS.sansCn : PDF_FONTS.sansEn;
  return (
    <PdfPageShell>
      {/* 纯白底（覆盖 Shell 暖纸色） */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />

      {/* 右侧竖长图（几乎满高） */}
      <PdfImage src={d['image']} style={{ position: 'absolute', left: 330, top: 52, width: 426, height: 1015 }} position={imagePos?.['image']} />

      {/* 竖排大标题（rotate -90°，沿左侧自下而上） */}
      <View style={{ position: 'absolute', left: 130, top: 404, transform: 'rotate(-90deg)', transformOrigin: 'top left' }}>
        <Text style={{ width: 333, fontFamily: titleFont, fontWeight: 'bold', fontSize: 75, lineHeight: 1, color: INK }}>{d['title']}</Text>
      </View>

      {/* 竖排英文装饰小字 · 靠内侧（rotate -90°） */}
      <View style={{ position: 'absolute', left: 43, top: 460, transform: 'rotate(-90deg)', transformOrigin: 'top left' }}>
        <Text style={{ fontFamily: PDF_FONTS.serifCn, fontSize: 24, lineHeight: 1, color: INK }}>{d['label1']}</Text>
      </View>

      {/* 竖排英文装饰小字 · 靠外侧（rotate -90°） */}
      <View style={{ position: 'absolute', left: 76, top: 440, transform: 'rotate(-90deg)', transformOrigin: 'top left' }}>
        <Text style={{ fontFamily: PDF_FONTS.serifCn, fontSize: 24, lineHeight: 1, color: INK }}>{d['label2']}</Text>
      </View>

      {/* 固定 furniture · 引号装饰字形（非槽位） */}
      <Text style={{ position: 'absolute', left: 183, top: 452, width: 113, fontFamily: PDF_FONTS.serifEn, fontSize: 120, lineHeight: 1, color: INK }}>&rdquo;</Text>

      {/* 固定 furniture · 导语上方细分隔线（非槽位） */}
      <View style={{ position: 'absolute', left: 53, top: 710, width: 227, height: 1, backgroundColor: INK }} />

      {/* 导语小标题（横排） */}
      <Text style={{ position: 'absolute', left: 53, top: 587, width: 243, fontFamily: PDF_FONTS.serifCn, fontSize: 24, lineHeight: 1.3, color: INK }}>{d['explain']}</Text>

      {/* 正文段落 */}
      <Text style={{ position: 'absolute', left: 56, top: 754, width: 240, fontFamily: PDF_FONTS.sansCn, fontSize: 19, lineHeight: 1.6, color: INK }}>{d['body']}</Text>
    </PdfPageShell>
  );
}
