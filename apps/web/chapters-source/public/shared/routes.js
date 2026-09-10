// Locale names and prefix rules match apps/web/src/lib/i18n/routing.ts.
export const locales = ['en','zh','es','ja','fr'];
export const LOCALE_LABELS = {en:'English',zh:'中文',es:'Español',ja:'日本語',fr:'Français'};
export const localeCookieName = 'YUJEE_LOCALE';
export const defaultLocale = 'en';
export function stripLocale(pathname) { const first=pathname.split('/')[1]; return locales.includes(first)?pathname.slice(first.length+1)||'/':pathname; }
export function detectLocale(pathname=globalThis.location?.pathname||'/') {
  const first=pathname.split('/')[1]; if(locales.includes(first))return first;
  const cookie=globalThis.document?.cookie.split('; ').find(c=>c.startsWith(localeCookieName+'='))?.split('=')[1];
  return locales.includes(cookie)?cookie:(['127.0.0.1','localhost'].includes(globalThis.location?.hostname)?'zh':defaultLocale);
}
export function localizePath(pathname,locale) {const p=stripLocale(pathname);return `/${locale}${p==='/'?'':p}`;}
export function spacePath(space,locale=detectLocale()) {return `/${locale}/${{pet:'pet',travel:'travel',palace:'palace'}[space]}/`;}
export const sharedAsset = path => `/pet/shared/${path}`;
export function assetUrl(path) {
  if(typeof path!=='string')return path;
  if(path.startsWith('/photos/'))return '/pet'+path;
  if(path.startsWith('/image-studio/'))return path.replace('/image-studio/','/travel/');
  if(path.startsWith('./photos/'))return `${stripLocale(globalThis.location?.pathname||'/travel/').includes('palace')?'/palace':'/travel'}/photos/${path.slice(9)}`;
  return path;
}
