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

const WEB_ART_FONT: Record<ArtFontPack, WebFontFamily> = {
  'serif-classic': WEB_FONTS.serifEn,
  'sans-modern': WEB_FONTS.sansEn,
  'script-elegant': WEB_FONTS.playfair,
  'display-bold': WEB_FONTS.bebas,
};

const PDF_ART_FONT: Record<ArtFontPack, PdfFontFamily> = {
  'serif-classic': PDF_FONTS.serifEn,
  'sans-modern': PDF_FONTS.sansEn,
  'script-elegant': PDF_FONTS.serifEn,
  'display-bold': PDF_FONTS.bebas,
};

function textValue(value: TemplateData[string]): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function artFontValue(value: TemplateData[string]): ArtFontPack | undefined {
  if (
    value === 'serif-classic' ||
    value === 'sans-modern' ||
    value === 'script-elegant' ||
    value === 'display-bold'
  ) {
    return value;
  }
  return undefined;
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
