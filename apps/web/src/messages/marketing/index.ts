import type { Locale } from '@/lib/i18n/routing';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import type { MarketingMessages } from './types';
import { zh } from './zh';

export type { MarketingMessages } from './types';

const dict: Record<Locale, MarketingMessages> = { en, zh, es, ja, fr };

export function getMarketingMessages(locale: Locale): MarketingMessages {
  return dict[locale];
}
