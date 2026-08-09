import type { Locale } from '@/lib/i18n/routing';
import { EN } from './en';
import { ES } from './es';
import { FR } from './fr';
import { JA } from './ja';
import type { FaqEntry } from './types';
import { ZH } from './zh';

export type { FaqEntry } from './types';

const BY_LOCALE: Record<Locale, readonly FaqEntry[]> = { en: EN, zh: ZH, es: ES, ja: JA, fr: FR };

export function getFaqEntries(locale: Locale): readonly FaqEntry[] {
  return BY_LOCALE[locale];
}
