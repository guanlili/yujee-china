import type { Locale } from '@/lib/i18n/routing';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import type { Copy } from './types';
import { zh } from './zh';

export type { Copy, PreviewChapter, Sample } from './types';

export const LANDING_COPIES: Record<Locale, Copy> = { en, zh, es, ja, fr };
