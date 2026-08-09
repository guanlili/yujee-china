import type { Locale } from '@/lib/i18n/routing';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import type { EmailCopy } from './types';
import { zh } from './zh';

export type { EmailCopy } from './types';

const BY_LOCALE: Record<Locale, EmailCopy> = { en, zh, es, ja, fr };

export function getEmailCopy(locale: Locale): EmailCopy {
  return BY_LOCALE[locale];
}
