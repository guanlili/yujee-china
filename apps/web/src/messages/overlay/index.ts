import type { Locale } from '@/lib/i18n/routing';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';

/**
 * Editor-surface overlays: a gettext-style table keyed by the **English source
 * string**, not by a symbolic key.
 *
 * Why keyed by English: the editor lives in two very large, very active files
 * (ChatPanel.tsx ~2.7k lines, EditorPort.tsx ~6.3k lines) whose copy is written
 * inline as `aT('中文', 'English')` / `pick(locale, { zh, en })` pairs. Key-ifying
 * every one of those call sites would rewrite most of both files and collide with
 * every other branch touching them. Overlays let a translator add a language by
 * writing one new file and touching nothing else.
 *
 * A miss falls back to English on purpose — a partly-translated editor in English
 * is a graceful degradation; a crash or an empty label is not.
 *
 * Coverage note for translators: the keys to fill are the English literals of
 * every `pick(locale, { zh, en })` call site **plus** every value in `chatI18n.en`
 * (see editor-coordinator.ts), which the editor resolves through `pick` too.
 */
export const OVERLAYS: Partial<Record<Locale, Record<string, string>>> = {
  es,
  ja,
  fr,
};
