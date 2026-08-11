import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fr from '@/messages/fr.json';
import ja from '@/messages/ja.json';
import zh from '@/messages/zh.json';
import { defaultLocale, type Locale } from './routing';

const messageMap = { en, zh, es, ja, fr } as const;

export type AppMessages = typeof en;

export function getMessages(locale: Locale): AppMessages {
  return messageMap[locale] ?? messageMap[defaultLocale];
}
