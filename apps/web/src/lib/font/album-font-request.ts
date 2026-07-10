import {
  THEME_ACCENT_CARRIER_SUFFIX,
  THEME_FONT_CARRIER_SUFFIX,
} from '@yujee/contracts';
import type { AdaptablePage } from '@/components/album/adapt-layout';
import { isCjkFontId, type CjkFontId } from '@/services/font/font-manifest';

// Printable ASCII plus common CJK punctuation keeps template furniture and
// punctuation available even when it is not present in user-authored text.
const BASE_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~' +
  '。，、；：？！“”‘’（）〈〉《》「」『』【】〔〕…—～·／％＃＆＊';

const CHARSET_LIMIT = 5000;
const FONT_LIMIT = 3;

function isCarrier(key: string): boolean {
  return key.endsWith(THEME_FONT_CARRIER_SUFFIX)
    || key.endsWith(THEME_ACCENT_CARRIER_SUFFIX);
}

export interface AlbumFontRequest {
  charset: string;
  fontIds: CjkFontId[];
}

export function collectAlbumFontRequest(pages: AdaptablePage[]): AlbumFontRequest {
  const chars = new Set(BASE_CHARS);
  const fontIds = new Set<CjkFontId>();

  for (const page of pages) {
    for (const [key, value] of Object.entries(page.texts)) {
      if (key.endsWith(THEME_FONT_CARRIER_SUFFIX)) {
        if (fontIds.size < FONT_LIMIT && isCjkFontId(value)) fontIds.add(value);
        continue;
      }
      if (isCarrier(key)) continue;
      for (const char of value) chars.add(char);
    }
  }

  return {
    charset: [...chars].slice(0, CHARSET_LIMIT).join(''),
    fontIds: [...fontIds],
  };
}
