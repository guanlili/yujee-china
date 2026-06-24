import { View } from '@react-pdf/renderer';
import { PAGE } from '../constants';
import { PdfImage, PdfPageShell } from '../pdf-utils';
import type { TemplateRenderProps } from '../types';

// 满铺九宫格内页（PDF 端，与 index.tsx 同一版面 / 同一坐标）。全页白底 View 覆盖 Shell 暖纸色；
// 行优先编号 image1..image9、无文字。版式来自 Figma A4-20（node 12:68）。
// 列边界 0/264/530（宽 264/266/264）、行边界 0/379/751（高 379/372/372）满铺无缝。

const COLS = [0, 264, 530];
const COL_W = [264, 266, 264];
const ROW_TOP = [0, 379, 751];
const ROW_H = [379, 372, 372];

const SLOTS = [
  { id: 'image1', col: 0, row: 0 },
  { id: 'image2', col: 1, row: 0 },
  { id: 'image3', col: 2, row: 0 },
  { id: 'image4', col: 0, row: 1 },
  { id: 'image5', col: 1, row: 1 },
  { id: 'image6', col: 2, row: 1 },
  { id: 'image7', col: 0, row: 2 },
  { id: 'image8', col: 1, row: 2 },
  { id: 'image9', col: 2, row: 2 },
] as const;

export function PdfMag48({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  return (
    <PdfPageShell>
      {/* 全页白底覆盖 Shell 暖纸色 */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, backgroundColor: '#FFFFFF' }} />
      {SLOTS.map(({ id, col, row }) => (
        <PdfImage
          key={id}
          src={d[id]}
          style={{ position: 'absolute', left: COLS[col], top: ROW_TOP[row], width: COL_W[col], height: ROW_H[row] }}
          position={imagePos?.[id]}
        />
      ))}
    </PdfPageShell>
  );
}
