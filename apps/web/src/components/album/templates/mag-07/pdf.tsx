import { Text, View } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfFolio, PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

export function PdfMag07({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    imageTop?: string;
    imageMain?: string;
    caption1?: string;
    caption2?: string;
    title?: string;
    folio?: string;
  };
  // ── 各槽位几何（与 index.tsx 保持一致；直接改这里的数字）──
  // 坐标系：整页 794×1123 px，左上角 (0,0)，单位 px。
  const LAYOUT = {
    caption1: { x: 50, y: 150, w: 240, h: 330, fontSize: 18 }, // 文本框1（上）：x/y 位置、h 高度、fontSize 字号均可编辑
    caption2: { x: 50, y: 510, w: 240, h: 420, fontSize: 18 }, // 文本框2（下，对齐大图）：x/y 位置、h 高度、fontSize 字号均可编辑
    title: { x: 50, bottom: 70, fontSize: 56 }, // 标题（贴底；bottom 越大越往上）
    imageTop: { x: 364, y: 90, w: 380, h: 330 }, // 上方横图
    imageMain: { x: 364, y: 450, w: 380, h: 480 }, // 下方竖图（大）
  };
  const cap = (text: string, fontSize: number) => (
    <Text style={{ lineHeight: 1.7, color: COLORS.ink2, textAlign: 'justify', fontSize }}>
      {text}
    </Text>
  );
  return (
    <PdfPageShell fontFamily={PDF_FONTS.sansEn}>
      <View
        style={{
          position: 'absolute',
          top: LAYOUT.caption1.y,
          left: LAYOUT.caption1.x,
          width: LAYOUT.caption1.w,
          height: LAYOUT.caption1.h,
        }}
      >
        {cap(d.caption1 || '', LAYOUT.caption1.fontSize)}
      </View>
      <PdfImage
        src={d.imageTop}
        style={{ position: 'absolute', left: 364, top: 60, width: 380, height: 330 }}
        position={imagePos?.['imageTop']}
      />
      <View
        style={{
          position: 'absolute',
          top: LAYOUT.caption2.y,
          left: LAYOUT.caption2.x,
          width: LAYOUT.caption2.w,
          height: LAYOUT.caption2.h,
        }}
      >
        {cap(d.caption2 || '', LAYOUT.caption2.fontSize)}
      </View>
      <PdfImage
        src={d.imageMain}
        style={{ position: 'absolute', left: 364, top: 450, width: 380, height: 480 }}
        position={imagePos?.['imageMain']}
      />
      <Text
        style={{ position: 'absolute', left: 50, top: 984, width: 220, fontFamily: PDF_FONTS.serifEn,
          fontSize: LAYOUT.title.fontSize,
          lineHeight: 1.15,
          color: COLORS.ink }}
      >
        {d.title || 'FUSHI\nINARI'}
      </Text>
      <PdfFolio folio={d.folio} totalPages={totalPages} fallback="07" />
    </PdfPageShell>
  );
}
