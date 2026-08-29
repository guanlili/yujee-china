// 书页背景底色:设计环节「封面选择卡」里给用户选的一排底色。用户选定封面组时一并选,
// 确认后刷全书每页页根 [data-template] 的 background-color —— 与手动书页背景工具
// (page-html-dom.patchHtmlPageStyle)同一处 html 真相,不新造机制。
//
// 纯白 = 默认 = 不写 inline bg(留模板自带 background:#fff),所以整个功能对老书是纯叠加。
// ChatPanel(client)与 album-service(server)共用本模块;无外部依赖,两端都可 import。

export type PageBackground = { id: string; name: string; nameEn: string; hex: string };

export const PAGE_BACKGROUNDS: readonly PageBackground[] = [
  { id: 'white', name: '纯白', nameEn: 'White', hex: '#FFFFFF' },
  { id: 'ivory', name: '象牙白', nameEn: 'Ivory', hex: '#FBF8F1' },
  { id: 'mist', name: '冷雾白', nameEn: 'Mist', hex: '#F1F2F0' },
  { id: 'ash', name: '浅雾灰', nameEn: 'Ash', hex: '#ECEDEE' },
];

// 默认底色(纯白):等于模板默认,不写 inline bg。
export const DEFAULT_PAGE_BACKGROUND = PAGE_BACKGROUNDS[0]!.hex;

const HEX_SET = new Set(PAGE_BACKGROUNDS.map((b) => b.hex.toUpperCase()));

/** 是否是允许的 4 个底色之一(大小写无关)。 */
export function isValidPageBackground(hex: string): boolean {
  return HEX_SET.has(hex.toUpperCase());
}

/** 纯白视为「无底色」——等于模板默认,应用时不写 inline background-color。 */
export function isDefaultPageBackground(hex: string): boolean {
  return hex.toUpperCase() === DEFAULT_PAGE_BACKGROUND.toUpperCase();
}
