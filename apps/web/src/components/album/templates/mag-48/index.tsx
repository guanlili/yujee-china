import type { TemplateRenderProps } from '../types';
import { PAGE } from '../constants';
import { WebImage } from '../web-utils';

// 内页 · 满铺九宫格相册（category: interior，9 图、无文字）。白底；3 行 ×3 列竖图满铺整页，
// 行优先编号 image1..image9（上排左→右、中排左→右、下排左→右）。
// 版式来自 Figma A4-20（node 12:68，595×842 → ×1.3344 → 794×1123）。
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

export function WebMag48({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  return (
    <div style={{ position: 'relative', width: PAGE.width, height: PAGE.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {SLOTS.map(({ id, col, row }) => (
        <WebImage
          key={id}
          src={d[id]}
          style={{ position: 'absolute', left: COLS[col], top: ROW_TOP[row], width: COL_W[col], height: ROW_H[row], objectFit: 'cover' }}
          position={imagePos?.[id]}
          slotId={id}
        />
      ))}
    </div>
  );
}
