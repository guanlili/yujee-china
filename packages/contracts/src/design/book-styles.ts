// 四个书级风格：Agent 能调用的「气质」单位。每个风格 = 封面/封底模板 + 页底色 + 三个文字色。
//
// 为什么不是照搬选封面卡的四套：卡上四套配的页底色是 PAGE_BACKGROUNDS 的
// #FFFFFF/#FBF8F1/#F1F2F0/#ECEDEE —— 四个白，肉眼分不出；字体也不随套变。
// 照搬映射成四个风格，用户说「换成风格 2」时全书几乎不变，是个空功能。
// 所以这里给另外三套各自补了真配色（暖白 / 冷灰 / 暖砂），第三套沿用现成的多巴胺。
// （小雨拍板 2026-08-29，配色稿见 apps/web/scripts/render-style-preview.mts）
//
// ⚠️ 色值不是随便填的：非多巴胺三套的每个字色都卡着 4.5:1（见 book-styles.test.ts）。
// 两个 explain 色都是压深来的，别改回更浅的：
//   · magazine #6E7370 在 #E7EAE9 上实测 3.99 —— 不达标，压到 #646966 才有 4.62；
//   · postcard  #A8502E 在 #F1E7D5 上实测 4.45 —— 差 0.05，压到 #A34E2D 才有 4.65
//     （它本身已经是 p01 模板自带的 #d27b62（仅 2.9:1）压深过一轮的结果）。
// 改任何色值都要重跑测试，别凭眼睛判断。
import { PAGE_BACKGROUNDS } from './page-backgrounds';
import { type DarkInk, THIRD_SET_INK, THIRD_SET_INTERIOR } from './third-set-palette';

export type BookStyleId = 'editorial' | 'magazine' | 'dopamine' | 'postcard';

export type BookStyle = {
  id: BookStyleId;
  /** 给用户看的中文名。模型转述时用它，不要报 id。 */
  name: string;
  nameEn: string;
  /** 一句话气质，进 skill 和书级简报。 */
  mood: string;
  coverTemplateId: string;
  endingTemplateId: string;
  /** 主页底色。多巴胺是五色里的第一个，实际每页按 interiorInkSequence 抽。 */
  pageBackground: string;
  colors: { title: string; body: string; explain: string };
  /** 只有多巴胺有：内页可用的整张色表。其余风格靠 pageBackground 单色。 */
  interiorInks?: readonly DarkInk[];
};

export const BOOK_STYLES: readonly BookStyle[] = [
  {
    id: 'editorial',
    name: '素白散文',
    nameEn: 'Editorial',
    mood: '暖白纸配墨黑字，留白最多，长段落最好读',
    coverTemplateId: 'mag-01',
    endingTemplateId: 'mag-22',
    pageBackground: '#FBF8F1',
    colors: { title: '#1C1B18', body: '#2E2C27', explain: '#6B6760' },
  },
  {
    id: 'magazine',
    name: '杂志刊头',
    nameEn: 'Magazine',
    mood: '冷灰底配纯黑字，硬朗、信息密度高，像一本作品集',
    coverTemplateId: 'mag-23',
    endingTemplateId: 'mag-22',
    pageBackground: '#E7EAE9',
    colors: { title: '#0F0F0F', body: '#2B2E2C', explain: '#646966' },
  },
  {
    id: 'dopamine',
    name: '多巴胺',
    nameEn: 'Dopamine',
    mood: '整页满版彩色底，一页一个颜色，最跳最年轻',
    coverTemplateId: 'mag-62',
    endingTemplateId: 'mag-63',
    // 底色逐页由 interiorInkSequence 派，这里放第一个色只作为「代表色」用于预览和兜底。
    pageBackground: THIRD_SET_INTERIOR[0]!.bg,
    colors: { title: THIRD_SET_INK.dark, body: THIRD_SET_INK.dark, explain: THIRD_SET_INK.dark },
    interiorInks: THIRD_SET_INTERIOR,
  },
  {
    id: 'postcard',
    name: '旅行画报',
    nameEn: 'Postcard',
    mood: '暖砂底配陶土橙图注，胶片明信片感，适合旅途和老照片',
    coverTemplateId: 'p01',
    endingTemplateId: 'mag-22',
    pageBackground: '#F1E7D5',
    colors: { title: '#1C1B18', body: '#3A362E', explain: '#A34E2D' },
  },
];

export const DEFAULT_BOOK_STYLE_ID: BookStyleId = 'editorial';

export function bookStyleById(id: string | null | undefined): BookStyle | undefined {
  return BOOK_STYLES.find((s) => s.id === id);
}

/**
 * 从封面模板反推风格。**故意不存字段** —— 封面模板与风格一一对应，反推等于零迁移，
 * 老书自动就有风格。用户单独换过封面模板时风格跟着变，这是对的：封面就是风格的脸。
 *
 * 认不出的封面（换成了表外模板）回落 editorial 而不是抛错：Agent 任何时候都要能
 * 答出「这本书现在是什么风格」，答不出比答得不准更糟。
 */
export function bookStyleOf(coverTemplateId: string | null | undefined): BookStyle {
  return (
    BOOK_STYLES.find((s) => s.coverTemplateId === coverTemplateId) ??
    bookStyleById(DEFAULT_BOOK_STYLE_ID)!
  );
}

export type BackgroundOption = { id: string; name: string; hex: string };

/**
 * 多巴胺五色（THIRD_SET_INTERIOR）的中文展示名。**只在这里映射**——`DarkInk` 类型
 * 本身没有中文名字段（它是内页配色的真相源，见 third-set-palette.ts，不为 UI 展示
 * 多加字段），`THIRD_SET_INTERIOR` 表也不改。此前 `styleBackgroundOptions` 直接把
 * `name` 回落成 `ink.id`，模型转述给用户会拼出「刷成butter」这种中英混杂句子——
 * 项目规则禁止内部标识进用户回复，故补这张映射（2026-08-29 复盘裁定）。
 */
const DOPAMINE_INK_NAME: Record<string, string> = {
  butter: '淡黄',
  violet: '紫',
  orange: '橙',
  green: '绿',
  blue: '蓝',
};

/**
 * 某风格下页底色的合法取值。Agent 只能从这张表里挑，不能自由填 hex ——
 * 自由 hex 会超四色印刷色域（印不出）且对比度失守（小雨拍板 2026-08-29）。
 */
export function styleBackgroundOptions(styleId: string): BackgroundOption[] {
  const style = bookStyleById(styleId) ?? bookStyleById(DEFAULT_BOOK_STYLE_ID)!;
  if (style.interiorInks) {
    return style.interiorInks.map((ink) => ({ id: ink.id, name: DOPAMINE_INK_NAME[ink.id] ?? ink.id, hex: ink.bg }));
  }
  return [
    { id: style.id, name: style.name, hex: style.pageBackground },
    ...PAGE_BACKGROUNDS.map((b) => ({ id: b.id, name: b.name, hex: b.hex })),
  ];
}

/**
 * 书级配色种子：**封面（页数组第一页）的首图 photoId**，缺省回落封面模板 id。
 *
 * 为什么必须住在 contracts：这是一个**两端必须逐字相同**的约定 —— design-agent 的
 * `apply_book_style` 用它派 `interiorInkSequence`，把整本刷成多巴胺；apps/web 在
 * 落库时要按同一个公式把种子记回 `draft.design.interiorSeed`，追加照片那条路才能
 * 复算出同一串序列、给新页派到与全书同一套色。两边各写一份的话，第一次改公式就会
 * 让「换完风格再加照片」串色（2026-08-29 最终评审 Critical 1 的病根之一）。
 *
 * 只要对同一本书稳定即可 —— 逐项前缀稳定性由 `interiorInkSequence` 自身保证
 * （第 i 项只取决于 seed 和 i），不依赖这里选了哪个字段。
 */
export function bookStyleSeed(
  pages: readonly { templateId: string; images: Record<string, string> }[],
): string {
  const cover = pages[0];
  return Object.values(cover?.images ?? {})[0] ?? cover?.templateId ?? 'yujee';
}
