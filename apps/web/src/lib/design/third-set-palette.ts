// 第三套(深色椭圆)的配色真相源。封面色和内页色**分开管** —— 封面是一整张
// 视觉主张,内页要顾及照片和长段落阅读,两者约束不同,不共用一张色表。
// 所有色值都过了对比度实测(见同目录 .test.ts),改色必须同步跑测试。

export const THIRD_SET_COVER_TEMPLATE_ID = 'mag-62';

export type CoverColorway = {
  id: string;
  name: string;
  nameEn: string;
  bg: string;
  /** 主标题色 */
  title: string;
  /** 副标题 / 竖排系列名 / 底部署名色 */
  sub: string;
};

export const THIRD_SET_COVERS: readonly CoverColorway[] = [
  { id: 'teal', name: '深墨绿', nameEn: 'Deep Teal', bg: '#12363A', title: '#F0A4C2', sub: '#E7E3D8' },
  { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
  { id: 'pink', name: '粉', nameEn: 'Pink', bg: '#F0A4C2', title: '#1F3A24', sub: '#3A2B31' },
  { id: 'navy', name: '深蓝', nameEn: 'Navy', bg: '#0E2A47', title: '#F1EFE8', sub: '#C9D3DE' },
];

export const DEFAULT_COVER_COLORWAY_ID = THIRD_SET_COVERS[0]!.id;

export function coverColorwayById(id: string | null | undefined): CoverColorway | undefined {
  if (!id) return undefined;
  return THIRD_SET_COVERS.find((c) => c.id === id);
}

/** 内页深底配色。accent 给 title/decoration,body 给 body/explain。 */
export type DarkInk = { id: string; bg: string; accent: string; body: string };

// 荧光绿/黄绿是真荧光色,四色印刷印不出来,需专色油墨(Pantone Neon / Riso 荧光墨);
// 不加专色时实体书上会偏闷。这是已知并接受的代价,见 spec 三.3。
export const THIRD_SET_INTERIOR: readonly DarkInk[] = [
  { id: 'navy-lime', bg: '#0E2A47', accent: '#B8FF3C', body: '#E8E5DC' },
  { id: 'teal-pink', bg: '#12363A', accent: '#F0A4C2', body: '#E8E5DC' },
  { id: 'ink-lime', bg: '#14140F', accent: '#D4FF3F', body: '#E8E5DC' },
];
