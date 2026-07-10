export const CJK_FONT_IDS = [
  'noto-serif-sc',
  'noto-sans-sc',
  'zcool-xiaowei',
  'lxgw-wenkai',
  'smiley-sans',
  'zcool-qingke-huangyou',
  'long-cang',
  'zhi-mang-xing',
  'liu-jian-mao-cao',
] as const;

export type CjkFontId = (typeof CJK_FONT_IDS)[number];

export const CJK_FONT_MANIFEST: Record<
  CjkFontId,
  { family: string; file: string }
> = {
  'noto-serif-sc': { family: 'NotoSerifSC', file: 'NotoSerifSC-Regular.ttf' },
  'noto-sans-sc': { family: 'NotoSansSC', file: 'NotoSansSC-Regular.ttf' },
  'zcool-xiaowei': { family: 'ZCOOL XiaoWei', file: 'art/ZCOOLXiaoWei-Regular.ttf' },
  'lxgw-wenkai': { family: 'LXGW WenKai', file: 'art/LXGWWenKai-Regular.ttf' },
  'smiley-sans': { family: 'Smiley Sans', file: 'art/SmileySans-Oblique.ttf' },
  'zcool-qingke-huangyou': {
    family: 'ZCOOL QingKe HuangYou',
    file: 'art/ZCOOLQingKeHuangYou-Regular.ttf',
  },
  'long-cang': { family: 'Long Cang', file: 'art/LongCang-Regular.ttf' },
  'zhi-mang-xing': { family: 'Zhi Mang Xing', file: 'art/ZhiMangXing-Regular.ttf' },
  'liu-jian-mao-cao': {
    family: 'Liu Jian Mao Cao',
    file: 'art/LiuJianMaoCao-Regular.ttf',
  },
};

const CJK_FONT_ID_SET = new Set<string>(CJK_FONT_IDS);

export function isCjkFontId(value: string): value is CjkFontId {
  return CJK_FONT_ID_SET.has(value);
}
