import type { ArtFontPack } from '@yujee/contracts/enums';
import {
  THEME_ACCENT_CARRIER_SUFFIX,
  THEME_FONT_CARRIER_SUFFIX,
} from '@yujee/contracts';
import { PDF_FONTS, WEB_FONTS } from './constants';
import type { TemplateData } from './types';

type WebFontFamily = (typeof WEB_FONTS)[keyof typeof WEB_FONTS];
type PdfFontFamily = (typeof PDF_FONTS)[keyof typeof PDF_FONTS];

export interface ResolvedThemeCarrier {
  text?: string;
  accentColor?: string;
  artFont?: ArtFontPack;
  webFontFamily?: WebFontFamily;
  pdfFontFamily?: PdfFontFamily;
}

// 艺术字 id → web 字体族。id 清单镜像 contracts ArtFontPack / design-agent font-registry。
// 未 vendor 二进制的字体，首选族缺失时按 WEB_FONTS 里的回退链落到 Noto/系统字，不崩。
const WEB_ART_FONT: Record<ArtFontPack, WebFontFamily> = {
  // 旧占位包（兼容保留）
  'serif-classic': WEB_FONTS.serifEn,
  'sans-modern': WEB_FONTS.sansEn,
  'script-elegant': WEB_FONTS.playfair,
  'display-bold': WEB_FONTS.bebas,
  // 中文
  'noto-serif-sc': WEB_FONTS.serifCn,
  'noto-sans-sc': WEB_FONTS.sansCn,
  'zcool-xiaowei': WEB_FONTS.zcoolXiaowei,
  'lxgw-wenkai': WEB_FONTS.lxgwWenkai,
  'smiley-sans': WEB_FONTS.smileySans,
  'zcool-qingke-huangyou': WEB_FONTS.zcoolQingke,
  'long-cang': WEB_FONTS.longCang,
  'zhi-mang-xing': WEB_FONTS.zhiMangXing,
  'liu-jian-mao-cao': WEB_FONTS.liuJianMaoCao,
  // 英文·正文
  'eb-garamond': WEB_FONTS.serifEn,
  'source-serif-4': WEB_FONTS.sourceSerif,
  lora: WEB_FONTS.lora,
  'libre-baskerville': WEB_FONTS.libreBaskerville,
  inter: WEB_FONTS.sansEn,
  'work-sans': WEB_FONTS.worksans,
  'dm-sans': WEB_FONTS.dmSans,
  poppins: WEB_FONTS.poppins,
  raleway: WEB_FONTS.raleway,
  // 英文·标题
  'playfair-display': WEB_FONTS.playfair,
  'cormorant-garamond': WEB_FONTS.cormorant,
  'bebas-neue': WEB_FONTS.bebas,
  'archivo-black': WEB_FONTS.archivoBlack,
  'abril-fatface': WEB_FONTS.abril,
  montserrat: WEB_FONTS.montserrat,
  // 英文·装饰
  'ibm-plex-mono': WEB_FONTS.ibmPlexMono,
  'jetbrains-mono': WEB_FONTS.mono,
  'great-vibes': WEB_FONTS.greatVibes,
  'dancing-script': WEB_FONTS.dancingScript,
  sacramento: WEB_FONTS.sacramento,
  parisienne: WEB_FONTS.parisienne,
};

// 艺术字 id → PDF 字体。新字体的二进制未在 registerPdfFonts 注册前，一律映射到**已注册**的
// 最近字体（中文→Noto SC subset，拉丁→ garamond/interEn/Courier 等），保证 @react-pdf 不报缺字体。
const PDF_ART_FONT: Record<ArtFontPack, PdfFontFamily> = {
  'serif-classic': PDF_FONTS.serifEn,
  'sans-modern': PDF_FONTS.sansEn,
  'script-elegant': PDF_FONTS.serifEn,
  'display-bold': PDF_FONTS.bebas,
  // 中文 → Noto SC subset
  'noto-serif-sc': PDF_FONTS.serifCn,
  'noto-sans-sc': PDF_FONTS.sansCn,
  'zcool-xiaowei': PDF_FONTS.serifCn,
  'lxgw-wenkai': PDF_FONTS.serifCn,
  'smiley-sans': PDF_FONTS.sansCn,
  'zcool-qingke-huangyou': PDF_FONTS.sansCn,
  'long-cang': PDF_FONTS.serifCn,
  'zhi-mang-xing': PDF_FONTS.serifCn,
  'liu-jian-mao-cao': PDF_FONTS.serifCn,
  // 英文·正文
  'eb-garamond': PDF_FONTS.garamond,
  'source-serif-4': PDF_FONTS.garamond,
  lora: PDF_FONTS.lora,
  'libre-baskerville': PDF_FONTS.garamond,
  inter: PDF_FONTS.interEn,
  'work-sans': PDF_FONTS.worksans,
  'dm-sans': PDF_FONTS.interEn,
  poppins: PDF_FONTS.poppins,
  raleway: PDF_FONTS.raleway,
  // 英文·标题
  'playfair-display': PDF_FONTS.playfair,
  'cormorant-garamond': PDF_FONTS.garamond,
  'bebas-neue': PDF_FONTS.bebas,
  'archivo-black': PDF_FONTS.interEn,
  'abril-fatface': PDF_FONTS.abril,
  montserrat: PDF_FONTS.montserrat,
  // 英文·装饰
  'ibm-plex-mono': PDF_FONTS.mono,
  'jetbrains-mono': PDF_FONTS.mono,
  'great-vibes': PDF_FONTS.garamond,
  'dancing-script': PDF_FONTS.garamond,
  sacramento: PDF_FONTS.garamond,
  parisienne: PDF_FONTS.garamond,
};

function textValue(value: TemplateData[string]): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function artFontValue(value: TemplateData[string]): ArtFontPack | undefined {
  return typeof value === 'string' && Object.hasOwn(WEB_ART_FONT, value)
    ? (value as ArtFontPack)
    : undefined;
}

export function resolveThemeCarrier(data: TemplateData, slotId: string): ResolvedThemeCarrier {
  const text = textValue(data[slotId]);
  const accentColor = textValue(data[`${slotId}${THEME_ACCENT_CARRIER_SUFFIX}`]);
  const artFont = artFontValue(data[`${slotId}${THEME_FONT_CARRIER_SUFFIX}`]);

  return {
    text,
    accentColor,
    artFont,
    webFontFamily: artFont ? WEB_ART_FONT[artFont] : undefined,
    pdfFontFamily: artFont ? PDF_ART_FONT[artFont] : undefined,
  };
}
