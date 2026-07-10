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
  { webFamily: string; pdfFamily: string; file: string }
> = {
  'noto-serif-sc': {
    webFamily: 'Noto Serif SC', pdfFamily: 'NotoSerifSC', file: 'NotoSerifSC-Regular.ttf',
  },
  'noto-sans-sc': {
    webFamily: 'Noto Sans SC', pdfFamily: 'NotoSansSC', file: 'NotoSansSC-Regular.ttf',
  },
  'zcool-xiaowei': {
    webFamily: 'ZCOOL XiaoWei', pdfFamily: 'ZCOOL XiaoWei', file: 'art/ZCOOLXiaoWei-Regular.ttf',
  },
  'lxgw-wenkai': {
    webFamily: 'LXGW WenKai', pdfFamily: 'LXGW WenKai', file: 'art/LXGWWenKai-Regular.ttf',
  },
  'smiley-sans': {
    webFamily: 'Smiley Sans', pdfFamily: 'Smiley Sans', file: 'art/SmileySans-Oblique.ttf',
  },
  'zcool-qingke-huangyou': {
    webFamily: 'ZCOOL QingKe HuangYou',
    pdfFamily: 'ZCOOL QingKe HuangYou',
    file: 'art/ZCOOLQingKeHuangYou-Regular.ttf',
  },
  'long-cang': {
    webFamily: 'Long Cang', pdfFamily: 'Long Cang', file: 'art/LongCang-Regular.ttf',
  },
  'zhi-mang-xing': {
    webFamily: 'Zhi Mang Xing', pdfFamily: 'Zhi Mang Xing', file: 'art/ZhiMangXing-Regular.ttf',
  },
  'liu-jian-mao-cao': {
    webFamily: 'Liu Jian Mao Cao',
    pdfFamily: 'Liu Jian Mao Cao',
    file: 'art/LiuJianMaoCao-Regular.ttf',
  },
};

const CJK_FONT_ID_SET = new Set<string>(CJK_FONT_IDS);

export function isCjkFontId(value: string): value is CjkFontId {
  return CJK_FONT_ID_SET.has(value);
}
