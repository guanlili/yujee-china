import type { Locale } from '@/lib/i18n/routing';
import type { InterviewCase } from '../interview';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import { zh } from './zh';

// 每情况一套引导语,拆成三条短消息连着发(模仿真人一句一句打字)。一章只问这一次,不追问。
// 已知的信息不再问(时间已知就不问时间,地点已知就不问地点)。
export const PROMPTS: Record<Locale, Record<InterviewCase, readonly [string, string, string]>> = {
  en,
  zh,
  es,
  ja,
  fr,
};
