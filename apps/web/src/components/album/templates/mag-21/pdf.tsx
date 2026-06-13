import { Text } from '@react-pdf/renderer';
import { COLORS, PDF_FONTS } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// PDF 镜像 WebMag21（画布生成的单图 record 版式）：近正方图槽 600×620 + 标题。
// 坐标与 web index.tsx 一致，保证双端渲染一致。
export function PdfMag21({ data }: TemplateRenderProps) {
  const d = data as { image1?: string; title?: string };
  return (
    <PdfPageShell fontFamily={PDF_FONTS.serifEn}>
      <PdfImage
        src={d.image1}
        style={{ position: 'absolute', left: 97, top: 110, width: 600, height: 620 }}
      />
      <Text
        style={{
          position: 'absolute',
          left: 97,
          top: 760,
          width: 600,
          fontSize: 44,
          fontFamily: PDF_FONTS.serifEn,
          color: COLORS.ink,
          textAlign: 'left',
          lineHeight: 1.4,
        }}
      >
        {d.title || ''}
      </Text>
    </PdfPageShell>
  );
}
