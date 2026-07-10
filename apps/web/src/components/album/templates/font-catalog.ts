import type { ArtFontPack } from '@yujee/contracts/enums';
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
  },
  'noto-sans-sc': {
    script: 'cjk',
    roles: ['body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.sansCn,
    pdfFontFamily: PDF_FONTS.sansCn,
  },
  'zcool-xiaowei': {
    script: 'cjk',
    roles: ['title', 'body', 'explain'],
    webFontFamily: WEB_FONTS.zcoolXiaowei,
    pdfFontFamily: PDF_FONTS.serifCn,
  },
  'lxgw-wenkai': {
    script: 'cjk',
    roles: ['title', 'body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.lxgwWenkai,
    pdfFontFamily: PDF_FONTS.serifCn,
  },
  'smiley-sans': {
    script: 'cjk',
    roles: TITLE,
    webFontFamily: WEB_FONTS.smileySans,
    pdfFontFamily: PDF_FONTS.sansCn,
  },
  'zcool-qingke-huangyou': {
    script: 'cjk',
    roles: TITLE,
    webFontFamily: WEB_FONTS.zcoolQingke,
    pdfFontFamily: PDF_FONTS.sansCn,
  },
  'long-cang': {
    script: 'cjk',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.longCang,
    pdfFontFamily: PDF_FONTS.serifCn,
  },
  'zhi-mang-xing': {
    script: 'cjk',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.zhiMangXing,
    pdfFontFamily: PDF_FONTS.serifCn,
  },
  'liu-jian-mao-cao': {
    script: 'cjk',
    roles: TITLE_DECORATION,
    webFontFamily: WEB_FONTS.liuJianMaoCao,
    pdfFontFamily: PDF_FONTS.serifCn,
  },

  // English body families.
  'eb-garamond': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.serifEn,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  'source-serif-4': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.sourceSerif,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  lora: {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.lora,
    pdfFontFamily: PDF_FONTS.lora,
  },
  'libre-baskerville': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.libreBaskerville,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  inter: {
    script: 'latin',
    roles: ['body', 'explain', 'decoration'],
    webFontFamily: WEB_FONTS.sansEn,
    pdfFontFamily: PDF_FONTS.interEn,
  },
  'work-sans': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.worksans,
    pdfFontFamily: PDF_FONTS.worksans,
  },
  'dm-sans': {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.dmSans,
    pdfFontFamily: PDF_FONTS.interEn,
  },
  poppins: {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.poppins,
    pdfFontFamily: PDF_FONTS.poppins,
  },
  raleway: {
    script: 'latin',
    roles: BODY,
    webFontFamily: WEB_FONTS.raleway,
    pdfFontFamily: PDF_FONTS.raleway,
  },

  // English title families.
  'playfair-display': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.playfair,
    pdfFontFamily: PDF_FONTS.playfair,
  },
  'cormorant-garamond': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.cormorant,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  'bebas-neue': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.bebas,
    pdfFontFamily: PDF_FONTS.bebas,
  },
  'archivo-black': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.archivoBlack,
    pdfFontFamily: PDF_FONTS.interEn,
  },
  'abril-fatface': {
    script: 'latin',
    roles: TITLE,
    webFontFamily: WEB_FONTS.abril,
    pdfFontFamily: PDF_FONTS.abril,
  },
  montserrat: {
    script: 'latin',
    roles: ['title', 'body', 'explain'],
    webFontFamily: WEB_FONTS.montserrat,
    pdfFontFamily: PDF_FONTS.montserrat,
  },

  // English decoration families.
  'ibm-plex-mono': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.ibmPlexMono,
    pdfFontFamily: PDF_FONTS.mono,
  },
  'jetbrains-mono': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.mono,
    pdfFontFamily: PDF_FONTS.mono,
  },
  'great-vibes': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.greatVibes,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  'dancing-script': {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.dancingScript,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  sacramento: {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.sacramento,
    pdfFontFamily: PDF_FONTS.garamond,
  },
  parisienne: {
    script: 'latin',
    roles: DECORATION,
    webFontFamily: WEB_FONTS.parisienne,
    pdfFontFamily: PDF_FONTS.garamond,
  },
} as const satisfies Record<ArtFontPack, AlbumFontCatalogEntry>;

export const DEFAULT_ALBUM_FONT = {
  cjk: {
    title: 'noto-serif-sc',
    body: 'noto-sans-sc',
    explain: 'noto-sans-sc',
    decoration: 'noto-sans-sc',
  },
  latin: {
    title: 'playfair-display',
    body: 'inter',
    explain: 'inter',
    decoration: 'inter',
  },
} as const satisfies Record<AlbumFontScript, Record<AlbumTextRole, ArtFontPack>>;
