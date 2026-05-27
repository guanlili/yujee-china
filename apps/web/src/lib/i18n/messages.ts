import en from '@/messages/en.json';
import zh from '@/messages/zh.json';
import { defaultLocale, type Locale } from './routing';

const messageMap = { en, zh } as const;

export type AppMessages = typeof en;

export function getMessages(locale: Locale): AppMessages {
  return messageMap[locale] ?? messageMap[defaultLocale];
}
