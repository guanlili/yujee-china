import type { ArtFontPack } from '../enums';
import { PDF_FONTS, WEB_FONTS } from './constants';

export type AlbumTextRole = 'title' | 'body' | 'explain' | 'decoration';
export type AlbumFontScript = 'cjk' | 'latin';

type WebFontFamily = (typeof WEB_FONTS)[keyof typeof WEB_FONTS];
type PdfFontFamily = (typeof PDF_FONTS)[keyof typeof PDF_FONTS];

export interface AlbumFontCatalogEntry {
  script: AlbumFontScript;
  roles: readonly AlbumTextRole[];
  webFontFamily: WebFontFamily;
  pdfFontFamily: PdfFontFamily;
  asset?: {
    delivery: 'server-subset' | 'public';
    file: string;
  };
}

const TITLE: readonly AlbumTextRole[] = ['title'];
const BODY: readonly AlbumTextRole[] = ['body', 'explain'];
const DECORATION: readonly AlbumTextRole[] = ['decoration'];
const TITLE_DECORATION: readonly AlbumTextRole[] = ['title', 'decoration'];

export const FONT_CATALOG = {
  // Legacy abstract carriers remain readable until their dormant callers are removed.
  'serif-classic': {
    script: 'latin',
    roles: ['title', 'body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.serifEn,
    pdfFontFamily: PDF_FONTS.serifEn,
  },
  'sans-modern': {
    script: 'latin',
    roles: ['title', 'body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.sansEn,
    pdfFontFamily: PDF_FONTS.sansEn,
  },
  'script-elegant': {
    script: 'latin',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.playfair,
    pdfFontFamily: PDF_FONTS.serifEn,
  },
  'display-bold': {
    script: 'latin',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.bebas,
    pdfFontFamily: PDF_FONTS.bebas,
  },

  // Chinese families cover both Han and Latin glyphs.
  'noto-serif-sc': {
    script: 'cjk',
    roles: ['title', 'body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.serifCn,
    pdfFontFamily: PDF_FONTS.serifCn,
    asset: { delivery: 'server-subset', file: 'NotoSerifSC-Regular.ttf' },
  },
  'noto-sans-sc': {
    script: 'cjk',
    roles: ['body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.sansCn,
    pdfFontFamily: PDF_FONTS.sansCn,
    asset: { delivery: 'server-subset', file: 'NotoSansSC-Regular.ttf' },
  },
  'zcool-xiaowei': {
    script: 'cjk',
    roles: ['title', 'body', 'explain'],
    webFontFamily: WEB_FONTS.zcoolXiaowei,
    pdfFontFamily: PDF_FONTS.zcoolXiaowei,
    asset: { delivery: 'server-subset', file: 'art/ZCOOLXiaoWei-Regular.ttf' },
  },
  'lxgw-wenkai': {
    script: 'cjk',
    roles: ['title', 'body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.lxgwWenkai,
    pdfFontFamily: PDF_FONTS.lxgwWenkai,
    asset: { delivery: 'server-subset', file: 'art/LXGWWenKai-Regular.ttf' },
  },
  'smiley-sans': {
    script: 'cjk',
    roles: TITLE,
    webFontFamily: WEB_FONTS.smileySans,
    pdfFontFamily: PDF_FONTS.smileySans,
    asset: { delivery: 'server-subset', file: 'art/SmileySans-Oblique.ttf' },
  },
  'zcool-qingke-huangyou': {
    script: 'cjk',
    roles: TITLE,
    webFontFamily: WEB_FONTS.zcoolQingke,
    pdfFontFamily: PDF_FONTS.zcoolQingke,
    asset: { delivery: 'server-subset', file: 'art/ZCOOLQingKeHuangYou-Regular.ttf' },
  },
  'long-cang': {
    script: 'cjk',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.longCang,
    pdfFontFamily: PDF_FONTS.longCang,
    asset: { delivery: 'server-subset', file: 'art/LongCang-Regular.ttf' },
  },
  'zhi-mang-xing': {
    script: 'cjk',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.zhiMangXing,
    pdfFontFamily: PDF_FONTS.zhiMangXing,
    asset: { delivery: 'server-subset', file: 'art/ZhiMangXing-Regular.ttf' },
  },
  'liu-jian-mao-cao': {
    script: 'cjk',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.liuJianMaoCao,
    pdfFontFamily: PDF_FONTS.liuJianMaoCao,
    asset: { delivery: 'server-subset', file: 'art/LiuJianMaoCao-Regular.ttf' },
  },

  // English body families.
  'eb-garamond': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.serifEn,
    pdfFontFamily: PDF_FONTS.garamond,
    asset: { delivery: 'public', file: 'EBGaramond.ttf' },
  },
  'source-serif-4': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.sourceSerif,
    pdfFontFamily: PDF_FONTS.sourceSerif,
    asset: { delivery: 'public', file: 'SourceSerif4.ttf' },
  },
  lora: {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.lora,
    pdfFontFamily: PDF_FONTS.lora,
    asset: { delivery: 'public', file: 'Lora.ttf' },
  },
  'libre-baskerville': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.libreBaskerville,
    pdfFontFamily: PDF_FONTS.libreBaskerville,
    asset: { delivery: 'public', file: 'LibreBaskerville.ttf' },
  },
  inter: {
    script: 'latin',
    roles: ['body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.sansEn,
    pdfFontFamily: PDF_FONTS.interEn,
    asset: { delivery: 'public', file: 'Inter.ttf' },
  },
  'work-sans': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.worksans,
    pdfFontFamily: PDF_FONTS.worksans,
    asset: { delivery: 'public', file: 'WorkSans.ttf' },
  },
  'dm-sans': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.dmSans,
    pdfFontFamily: PDF_FONTS.dmSans,
    asset: { delivery: 'public', file: 'DMSans.ttf' },
  },
  poppins: {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.poppins,
    pdfFontFamily: PDF_FONTS.poppins,
    asset: { delivery: 'public', file: 'Poppins.ttf' },
  },
  raleway: {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.raleway,
    pdfFontFamily: PDF_FONTS.raleway,
    asset: { delivery: 'public', file: 'Raleway.ttf' },
  },

  // English title families.
  'playfair-display': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.playfair,
    pdfFontFamily: PDF_FONTS.playfair,
    asset: { delivery: 'public', file: 'PlayfairDisplay.ttf' },
  },
  'cormorant-garamond': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.cormorant,
    pdfFontFamily: PDF_FONTS.cormorant,
    asset: { delivery: 'public', file: 'CormorantGaramond.ttf' },
  },
  'bebas-neue': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.bebas,
    pdfFontFamily: PDF_FONTS.bebas,
    asset: { delivery: 'public', file: 'BebasNeue.ttf' },
  },
  'archivo-black': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.archivoBlack,
    pdfFontFamily: PDF_FONTS.archivoBlack,
    asset: { delivery: 'public', file: 'ArchivoBlack.ttf' },
  },
  'abril-fatface': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.abril,
    pdfFontFamily: PDF_FONTS.abril,
    asset: { delivery: 'public', file: 'AbrilFatface.ttf' },
  },
  montserrat: {
    script: 'latin',
    roles: ['title', 'body', 'explain'],
    webFontFamily: WEB_FONTS.montserrat,
    pdfFontFamily: PDF_FONTS.montserrat,
    asset: { delivery: 'public', file: 'Montserrat.ttf' },
  },

  // English decoration families.
  'ibm-plex-mono': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.ibmPlexMono,
    pdfFontFamily: PDF_FONTS.ibmPlexMono,
    asset: { delivery: 'public', file: 'IBMPlexMono.ttf' },
  },
  'jetbrains-mono': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.mono,
    pdfFontFamily: PDF_FONTS.jetbrainsMono,
    asset: { delivery: 'public', file: 'JetBrainsMono.ttf' },
  },
  'great-vibes': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.greatVibes,
    pdfFontFamily: PDF_FONTS.greatVibes,
    asset: { delivery: 'public', file: 'GreatVibes.ttf' },
  },
  'dancing-script': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.dancingScript,
    pdfFontFamily: PDF_FONTS.dancingScript,
    asset: { delivery: 'public', file: 'DancingScript.ttf' },
  },
  sacramento: {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.sacramento,
    pdfFontFamily: PDF_FONTS.sacramento,
    asset: { delivery: 'public', file: 'Sacramento.ttf' },
  },
  parisienne: {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.parisienne,
    pdfFontFamily: PDF_FONTS.parisienne,
    asset: { delivery: 'public', file: 'Parisienne.ttf' },
  },
} as const satisfies Record<ArtFontPack, AlbumFontCatalogEntry>;

// role → 默认字体的三组策略(2026-07-13 用户拍板):
//   title            → 衬线(宋体 / Playfair)
//   body + explain   → 黑体(思源黑体 / Inter)
//   decoration       → 【艺术字体】(志莽行书 / Great Vibes)—— 装饰槽装的是
//                      「Series · No.01」「Chapter · 05」这类小标,要跟正文拉开质感。
export const DEFAULT_ALBUM_FONT = {
  cjk: {
    title: 'noto-serif-sc',
    body: 'noto-sans-sc',
    explain: 'noto-sans-sc',
    decoration: 'zhi-mang-xing',
  },
  latin: {
    title: 'playfair-display',
    body: 'inter',
    explain: 'inter',
    decoration: 'great-vibes',
  },
} as const satisfies Record<AlbumFontScript, Record<AlbumTextRole, ArtFontPack>>;
