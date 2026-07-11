import type { ArtFontPack } from '../enums';
import {
  THEME_ACCENT_CARRIER_SUFFIX,
  THEME_FONT_CARRIER_SUFFIX,
} from '../theme-carrier';
import {
  DEFAULT_ALBUM_FONT,
  FONT_CATALOG,
  type AlbumFontCatalogEntry,
  type AlbumTextRole,
} from './font-catalog';
import type { TemplateData } from './types';

export interface ResolvedThemeCarrier {
  text?: string;
  accentColor?: string;
  artFont?: ArtFontPack;
  webFontFamily?: AlbumFontCatalogEntry['webFontFamily'];
  pdfFontFamily?: AlbumFontCatalogEntry['pdfFontFamily'];
}

function textValue(value: TemplateData[string]): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function artFontValue(value: TemplateData[string]): ArtFontPack | undefined {
  return typeof value === 'string' && Object.hasOwn(FONT_CATALOG, value)
    ? (value as ArtFontPack)
    : undefined;
}

function fontForSlot(
  text: string | undefined,
  artFont: ArtFontPack | undefined,
  role: AlbumTextRole,
): AlbumFontCatalogEntry {
  const script = text
    && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
    ? 'cjk'
    : 'latin';
  const explicit: AlbumFontCatalogEntry | undefined = artFont
    ? FONT_CATALOG[artFont]
    : undefined;
  const canRenderText = script === 'latin' || explicit?.script === 'cjk';
  const allowsRole = explicit?.roles.includes(role) ?? false;
  const resolvedId = artFont && explicit && canRenderText && allowsRole
    ? artFont
    : DEFAULT_ALBUM_FONT[script][role];

  return FONT_CATALOG[resolvedId];
}

export function resolveThemeCarrier(
  data: TemplateData,
  slotId: string,
  role?: AlbumTextRole,
): ResolvedThemeCarrier {
  const text = textValue(data[slotId]);
  const accentColor = textValue(data[`${slotId}${THEME_ACCENT_CARRIER_SUFFIX}`]);
  const artFont = artFontValue(data[`${slotId}${THEME_FONT_CARRIER_SUFFIX}`]);
  const font = role ? fontForSlot(text, artFont, role) : artFont ? FONT_CATALOG[artFont] : undefined;

  return {
    text,
    accentColor,
    artFont,
    webFontFamily: font?.webFontFamily,
    pdfFontFamily: font?.pdfFontFamily,
  };
}

export type { AlbumTextRole } from './font-catalog';
