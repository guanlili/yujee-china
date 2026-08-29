import {
  ITEMS_GRID_CAPACITY,
  PAGE_BACKGROUND_CARRIER_KEY,
  TEMPLATES,
  THEME_ACCENT_CARRIER_SUFFIX,
  THEME_FONT_CARRIER_SUFFIX,
} from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { bakePagesHtml } from './bake-html';
import { patchHtmlPageStyle } from '@/components/album/page-html-dom';
import { PAGE_BACKGROUNDS, isDefaultPageBackground } from '@/lib/design/page-backgrounds';
import {
  THIRD_SET_COVER_TEMPLATE_ID,
  interiorInkSequence,
  legacyInteriorInkSequence,
  coverColorwayForAlbum,
  type CoverColorway,
} from '@/lib/design/third-set-palette';

// 设计环节的确定性应用层(纯函数,零 AI):封面组规则生成、模板文字槽 spec 提取、
// carrier sweep、成书页序组装。AI 决策(全书文案/封面封尾文案/字体)在 engine /v3/compose;
// 这里把决策落到 draft pages 上 —— Web 是状态真相源。

export type CoverSet = {
  coverTemplateId: string;
  coverPhotoId: string;
  endingTemplateId: string;
  endingPhotoId: string;
  // 每套推荐封面自带一个书页底色(4 套 × 4 色,一一对应);选定后刷全书。
  // 可选:老调用/内部组页(用 applyDesign 的 pageBackground 入参)不必带。
  pageBackground?: string;
  /**
   * 第三套(深色椭圆)专有:系统按 albumId 确定性派定的配色 id。其余套不带。
   * 这里**只放 id 字符串**,不放整张色表 —— 前端会把选中套的字段逐个塞进
   * POST /design 的请求体,而那个 zod schema 是 .strict():数组字段一旦泄进去
   * 就是 400,第三套的书直接组不出来(本分支已经栽过一次)。
   */
  coverColorway?: string;
};

export type DesignFonts = { title: string; body: string; decoration: string };
/**
 * 三个文字角色的颜色。`decoration` 可选:不给时装饰槽跟标题色走(全站通用口径,
 * 与 design-agent set_text_colors 一致);第三套的封面/封尾要单独给,见 sweepCarriers。
 */
export type DesignColors = {
  title: string;
  body: string;
  explain: string;
  decoration?: string;
};

// 三色恒黑:模板自带的文字色就是它(见 html-templates 里的 `{{COLOR:*|#1c1b18}}`)。
// compose 不再让模型选颜色(旧 /v3/design 出的三色实测也恒是这个值),Web 确定性填。
export const DESIGN_TEXT_COLOR = '#1c1b18';
export const DESIGN_COLORS: DesignColors = {
  title: DESIGN_TEXT_COLOR,
  body: DESIGN_TEXT_COLOR,
  explain: DESIGN_TEXT_COLOR,
};

// 字体兜底(与 engine compose handler `_DEFAULT_FONTS` 同值):compose 极端兜底可能
// 回空 fonts,carrier sweep 不能因此写空 —— Web 侧自带确定性默认。
const DEFAULT_FONTS: Record<'zh' | 'en', DesignFonts> = {
  zh: { title: 'noto-serif-sc', body: 'noto-serif-sc', decoration: 'great-vibes' },
  en: { title: 'playfair-display', body: 'eb-garamond', decoration: 'great-vibes' },
};

/** compose 回来的 fonts(可能缺键/空串/整体为空)→ 三键齐全的确定性字体。 */
export function normalizeDesignFonts(
  fonts: Record<string, string> | null | undefined,
  language: 'zh' | 'en',
): DesignFonts {
  const fallback = DEFAULT_FONTS[language] ?? DEFAULT_FONTS.en;
  const pick = (key: keyof DesignFonts): string => {
    const value = fonts?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value : fallback[key];
  };
  return { title: pick('title'), body: pick('body'), decoration: pick('decoration') };
}

/**
 * 逐槽合并文案:只覆盖 incoming 里**非空**的槽,其余保留 base(模板 sample)。
 * compose 的 coverTexts/endingTexts 会把模型没写出来的槽带着空串回来 —— 无脑写回
 * 会把封面从 sample 示例文案洗成空白,所以空串一律忽略。
 */
export function mergeSlotTexts(
  base: Record<string, string>,
  incoming: Record<string, string> | null | undefined,
): Record<string, string> {
  const out = { ...base };
  for (const [slotId, text] of Object.entries(incoming ?? {})) {
    if (typeof text !== 'string' || text.trim() === '') continue;
    out[slotId] = text;
  }
  return out;
}

/**
 * `coverTextBase` / `placeholderCoverTextBase` 共用的槽遍历逻辑,用 `allSlots` 参数
 * 区分两条路径的口径(两者曾经是逐字重复的两个函数,清理时删过一次,别再复活重复)。
 *
 * `allSlots=false`(真成稿路径,coverTextBase):**只**保留 role=title 槽的 sample。
 * 其余槽(body/explain/decoration)宁可空着 —— 那些槽的 sample 是模板作者写的
 * 具体年份和地名(mag-23 的 "2026\n2025\n2024" / "Shanghai \nBeijing\nDali"),
 * 模型没写出来时回落 sample 等于把别人的年份地名印在用户的书上,比空着更糟。
 * 标题槽例外:封面没有大标题是废版面,必须留兜底。
 *
 * `allSlots=true`(占位书路径,placeholderCoverTextBase):非 title 槽也回落 sample
 * ——占位书零 AI,内页文案本来就是模板 sample,整本书明示是「示例」,不存在「印
 * 别人年份地名」这个顾虑;封面反而要靠它撑住游客的第一印象。
 *
 * `albumTitle`(可选)是标题槽的**最后一道兜底**,两条路径共用同一条三级兜底链:
 *   AI 写的(占位书没有)→ 这本相册自己的标题(哪怕还是系统默认名)→ 模板 sample。
 * 只填**第一个** role=title 槽(与 engine `_with_album_title` 同口径:mag-23 有
 * title/title2 两个槽,两个都灌同一句会让书名在封面上重复两遍)。
 *
 * 为什么放在这里而不是回到 engine:原来的 bug 是默认标题**抢在 AI 前面**(它被写进
 * compose 提示词并要求原样使用,模型于是从不自己写标题),所以 buildComposeRequest
 * 对默认标题送 '' 这条必须保留。而 engine 的全局批次整个掉线时(compose.py 的
 * `global_dropped` 直接返回空 ComposeGlobalResult,连 `_fallback()` 都不走),
 * 封面文案是**空的**回到 Web —— 兜底只有落在 Web 这一层才罩得住那条路径。
 * 这里在 mergeSlotTexts 的 base 侧,AI 只要写出了标题就会覆盖它,不构成任何抢跑。
 */
function buildCoverTextBase(
  templateId: string,
  options: { albumTitle?: string | null; allSlots?: boolean },
): Record<string, string> {
  const out: Record<string, string> = {};
  const fallbackTitle = (options.albumTitle ?? '').trim();
  const allSlots = options.allSlots ?? false;
  let titleSlotFilled = false;
  for (const slot of templateOf(templateId)?.texts ?? []) {
    const isTitleSlot = slot.role === 'title';
    if (!isTitleSlot && !allSlots) continue;
    const sample = (slot as { sample?: unknown }).sample;
    if (isTitleSlot) {
      const useAlbumTitle = fallbackTitle !== '' && !titleSlotFilled;
      titleSlotFilled = true;
      if (useAlbumTitle) {
        out[slot.id] = fallbackTitle;
        continue;
      }
    }
    if (typeof sample === 'string' && sample !== '') out[slot.id] = sample;
  }
  return out;
}

/** 真成稿路径的封面/封尾文案兜底底稿。行为/签名不变,见 buildCoverTextBase(allSlots=false)。 */
export function coverTextBase(
  templateId: string,
  albumTitle?: string | null,
): Record<string, string> {
  return buildCoverTextBase(templateId, { albumTitle });
}

/**
 * 占位书专用(裁决见 2026-08-09 task-16):封面/封尾文案兜底底稿改用全量 sample ——
 * 即改动前 `sampleTexts` 的口径,非 title 槽也回落模板 sample。只给
 * `mergeComposeIntoDraft` 在 `isPlaceholder=true` 时用;真成稿路径继续用上面的
 * `coverTextBase`,两者共用 buildCoverTextBase,不是两份重复实现。
 */
export function placeholderCoverTextBase(
  templateId: string,
  albumTitle?: string | null,
): Record<string, string> {
  return buildCoverTextBase(templateId, { albumTitle, allSlots: true });
}

/**
 * compose 的 `pagesTexts`({[pageIndex]: {[slotId]: 文案}})逐槽写回内页。
 * · 逐槽覆盖,不整页替换 —— 模型没写的槽保留模板 sample;
 * · 没出现在 pagesTexts 里的页原样保留(某章写不出来也照常成稿,硬约束落点)。
 */
export function applyComposePagesTexts(
  pages: Page[],
  pagesTexts: Record<string, Record<string, string>> | null | undefined,
): Page[] {
  if (!pagesTexts || Object.keys(pagesTexts).length === 0) return pages;
  return pages.map((page) => {
    const incoming = pagesTexts[String(page.pageIndex)];
    if (!incoming) return page;
    return { ...page, texts: mergeSlotTexts(page.texts, incoming) };
  });
}

type TreePhoto = { photoId: string; composition?: string | null };
type TreeChapter = { photos: TreePhoto[] };

function templateOf(id: string) {
  return (TEMPLATES as Record<string, (typeof TEMPLATES)[keyof typeof TEMPLATES]>)[id];
}

export function templateCategory(templateId: string): string | undefined {
  return templateOf(templateId)?.category;
}

function templateIdsByCategory(category: string): string[] {
  return Object.values(TEMPLATES)
    .filter((t) => t.category === category)
    .map((t) => t.id)
    .sort();
}

function firstImageSlotId(templateId: string): string | undefined {
  return templateOf(templateId)?.images?.[0]?.id;
}

// hero 照片:构图 focal > closeup > 其余,取前 N 张(与 engine 封面候选同规则)。
export function pickHeroPhotos(chapters: TreeChapter[], count: number): string[] {
  const rank: Record<string, number> = { focal: 0, closeup: 1 };
  const photos = chapters.flatMap((c) => c.photos ?? []);
  return [...photos]
    .sort((a, b) => (rank[a.composition ?? ''] ?? 2) - (rank[b.composition ?? ''] ?? 2))
    .slice(0, count)
    .map((p) => p.photoId);
}

// 封尾模板:优先「有文字槽」的封底(engine 写的封尾文案要有槽可落;纯图 ending 会让
// 文案全部落空),按 albumId 确定性轮换;库里没有带文字槽的 ending 才退回纯图。
export function pickEndingTemplateId(albumId: string): string | undefined {
  const all = templateIdsByCategory('ending').filter((id) => firstImageSlotId(id));
  const withText = all.filter((id) => (templateOf(id)?.texts ?? []).length > 0);
  const pool = withText.length > 0 ? withText : all;
  if (pool.length === 0) return undefined;
  const offset = [...albumId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % pool.length;
  return pool[offset];
}

// 四套固定顺序,不再按 albumId 轮换 —— 「第三套是深色椭圆」这个约定必须对每本书都成立,
// 轮换会让第 3 位在不同相册指向不同模板。每套一对一绑自己的封底。
//
// 下面三个 mag-22 是**临时值**:两个新封底版式(Task 13)落地后,第 1/2/4 套
// 各自改成新版式,第 3 套留 mag-22 或换成深色封底。这里显式写死而不是哈希,就是为了那天
// 改起来是改一张表,不是改一个算法。
//
// 封面槽位固定 4 个,已拍板(task-16):mag-01 / mag-23 / mag-62(第三套深色椭圆)/
// p01。加入 mag-62 时从原来的候选里挤出了 mag-32 —— 它照片占比 87%,四个候选里留白
// 最少,版面语言又和 mag-23 最接近,挤掉它对设计语言整体性的损失最小。要换成挤掉别的,
// 改这张表一行即可。
//
// 第 3 套是深色套:mag-62(椭圆挖空封面)+ mag-63(纯装饰封底,零槽位)。它是四套里唯一
// 带 `coverColorway` 的 —— 系统按 albumId 确定性派四色之一,刷封面、封底和全部内页。
// 另外三套维持原样(白灰页底色 + mag-22 封底),线上行为不受深色套影响。
//
// 封底为什么只有第 3 套不同:mag-63 没有文字槽,AI 写的封尾结语在这一套里无处可落
// (已知代价,用户拍板选的「变体 A」)。第 1/2/4 套仍用 mag-22 的 5 个槽,所以
// compose 的封尾结语规则对它们照常有效 —— 那条 prompt 规则不能因为 mag-63 而改。
//
// ⚠️ **设计 Agent 那条路不受这张表约束**:它的模板目录直接读
// `packages/contracts/templates/*.json`,`list_templates({category:'cover'})` 会列出
// mag-62,而 `swap_page_template` 只校验 category 和图槽数。所以用户在对话里要求换封面
// 版式时,Agent 可能把一本**浅底书**的封面换成 mag-62 —— 那一页的 carrier 还是
// `#1c1b18`,落在 mag-62 的 `#12363A` 底上约 1.3:1,读不了。p01(深底模板)本来就有
// 同样的毛病,不是本分支引入的。真正的修法是「换成深底模板时 carrier 要跟着翻」,
// 属于设计 Agent 的写工具,不在这张表的范围内。
const SET_LAYOUT: ReadonlyArray<{ cover: string; ending: string }> = [
  { cover: 'mag-01', ending: 'mag-22' },
  { cover: 'mag-23', ending: 'mag-22' },
  { cover: THIRD_SET_COVER_TEMPLATE_ID, ending: 'mag-63' },
  { cover: 'p01', ending: 'mag-22' },
];

// 封面组规则生成:四套固定顺序(SET_LAYOUT),不再按 albumId 轮换。封面/封尾各自的照片
// 取 hero(2 张):封面统一用第一张,封尾配第二张(与封面不同则用之,否则同张)。
export function buildCoverSets(albumId: string, chapters: TreeChapter[]): CoverSet[] {
  const heroes = pickHeroPhotos(chapters, 2);
  if (heroes.length === 0) return [];
  const coverPhotoId = heroes[0]!;
  const endingPhotoId = heroes.find((id) => id !== coverPhotoId) ?? coverPhotoId;
  return SET_LAYOUT.filter(
    (s) => templateCategory(s.cover) === 'cover' && templateCategory(s.ending) === 'ending',
  ).map((s, i) => ({
    coverTemplateId: s.cover,
    coverPhotoId,
    endingTemplateId: s.ending,
    endingPhotoId,
    pageBackground: PAGE_BACKGROUNDS[i % PAGE_BACKGROUNDS.length]!.hex,
    // 第三套的配色由系统派定(按 albumId 确定性派生),用户不再挑;同一本书每次拿到
    // 的都是同一个 id,选择卡预览与最终成书因此永远一致。
    ...(s.cover === THIRD_SET_COVER_TEMPLATE_ID
      ? { coverColorway: coverColorwayForAlbum(albumId).id }
      : {}),
  }));
}

/**
 * 「用户选了这组封面」这条历史消息里的 layoutPatch.designApplied 标记。
 *
 * 两个写点(applyDesign 真成稿 / applyPlaceholderDesign 游客占位)共用这一个构造器 ——
 * 它们此前各写各的,真账号那条漏了 pageBackground/coverColorway,于是刷新回放时回执卡
 * 只能按浅底渲第三套的深色封面(粉标题 1.7:1)。同形是硬要求,别再分家。
 */
export function designAppliedMarker(input: {
  coverTemplateId: string;
  coverPhotoId: string;
  endingTemplateId: string;
  endingPhotoId: string;
  pageBackground?: string;
  coverColorway?: string;
}): Record<string, string> {
  return {
    coverTemplateId: input.coverTemplateId,
    coverPhotoId: input.coverPhotoId,
    endingTemplateId: input.endingTemplateId,
    endingPhotoId: input.endingPhotoId,
    ...(input.pageBackground ? { pageBackground: input.pageBackground } : {}),
    ...(input.coverColorway ? { coverColorway: input.coverColorway } : {}),
  };
}

// 模板文字槽 spec(engine DesignRequest 的 coverSlots/endingSlots 入参)。
export function slotSpecs(
  templateId: string,
): Array<{ id: string; role: string; sample: string }> {
  const template = templateOf(templateId);
  // 不传字数上限:模板不再声明。篇幅由 sample 示范(它就是该槽在版面上的实际长度参考),
  // 写长了不裁 —— 渲染层的 fit-text 会自动缩字号装下。
  return (template?.texts ?? []).map((slot) => ({
    id: slot.id,
    role: slot.role,
    sample: typeof (slot as { sample?: unknown }).sample === 'string' ? (slot as { sample: string }).sample : '',
  }));
}

// carrier sweep:按模板声明的文字槽 role,把三键字体/颜色写成 `${slotId}#artFont` /
// `${slotId}#accentColor`(web/PDF 渲染端 theme-carrier 消费的同一格式)。
// decoration 颜色默认跟标题色(与 design-agent set_text_colors 口径一致);
// colors 显式带 decoration 时以它为准 —— 第三套的封面/封尾靠这条把竖排系列名和
// 两行署名刷成配色的 sub 色(THIRD_SET_COVERS 的契约就是「副标题/竖排系列名/底部
// 署名」用 sub),不再跟着主标题变粉。默认规则对其余三套一个字没改。
export function sweepCarriers(
  pages: Page[],
  fonts: DesignFonts,
  colors: DesignColors | ((page: Page) => DesignColors),
): Page[] {
  const fontByRole: Record<string, string> = {
    title: fonts.title,
    body: fonts.body,
    explain: fonts.body,
    decoration: fonts.decoration,
  };
  return pages.map((page) => {
    const template = templateOf(page.templateId);
    if (!template) return page;
    const c = typeof colors === 'function' ? colors(page) : colors;
    const colorByRole: Record<string, string> = {
      title: c.title,
      body: c.body,
      explain: c.explain,
      decoration: c.decoration ?? c.title,
    };
    const texts = { ...page.texts };
    for (const slot of template.texts ?? []) {
      const font = fontByRole[slot.role];
      const color = colorByRole[slot.role];
      if (font) texts[`${slot.id}${THEME_FONT_CARRIER_SUFFIX}`] = font;
      if (color) texts[`${slot.id}${THEME_ACCENT_CARRIER_SUFFIX}`] = color;
    }
    // items 重复组的文字槽(mag-10 的 explain、mag-02 的 label/title2/explain):渲染端
    // 按 bracket 路径 `${slotId}[i]` 寻址(adapt-layout 把 items 组展成数组、fill-template
    // 的 roleFor 剥掉下标回查角色,accentColor/artFont 本身按这个完整键直查,不经过
    // roleFor)。这里必须原样写这个键形状 —— 写成裸 slotId 不会报错,但渲染端永远读不到,
    // 深色套上这些槽就只能落回模板默认色。容量用 items-grid 固定格数
    // ITEMS_GRID_CAPACITY:目前两个 items.texts 模板在 HTML 里都是硬写 4 格(0..3)。
    for (const slot of template.items?.texts ?? []) {
      const font = fontByRole[slot.role];
      const color = colorByRole[slot.role];
      for (let i = 0; i < ITEMS_GRID_CAPACITY; i += 1) {
        const key = `${slot.id}[${i}]`;
        if (font) texts[`${key}${THEME_FONT_CARRIER_SUFFIX}`] = font;
        if (color) texts[`${key}${THEME_ACCENT_CARRIER_SUFFIX}`] = color;
      }
    }
    return { ...page, texts };
  });
}

// 成书组装:封面在前、封尾在后,内页居中,pageIndex 全书重排。
// extraEndingPhotoIds:封底模板可能有多个图槽(如 mag-22 两图),第 1 槽用 endingPhotoId,
// 其余槽按序取补充照片,不够则复用最后一张 —— 图槽绝不留空。
export function assembleDesignedPages(input: {
  interiorPages: Page[];
  set: CoverSet;
  coverTexts: Record<string, string>;
  endingTexts: Record<string, string>;
  fonts: DesignFonts;
  colors: DesignColors;
  extraEndingPhotoIds?: string[];
  // 书页底色:用户在封面选择卡里选的 4 色之一,刷全书每页页根 background-color。
  // 纯白/未传 = 不写(留模板默认),见 applyPageBackground。
  pageBackground?: string;
  /** 第三套(深色椭圆)选中的配色;不传 = 走原来的单色 pageBackground 路径。 */
  colorway?: CoverColorway;
  /** 第三套内页随机配色的种子(这本书的 albumId)。缺省回落 colorway.id,见 darkInkByPageIndex。 */
  interiorSeed?: string;
}): Page[] {
  const coverSlot = firstImageSlotId(input.set.coverTemplateId);
  const endingSlotIds = (templateOf(input.set.endingTemplateId)?.images ?? []).map((s) => s.id);
  const endingPool = [
    input.set.endingPhotoId,
    ...(input.extraEndingPhotoIds ?? []).filter((id) => id !== input.set.endingPhotoId),
  ];
  const cover: Page = {
    pageIndex: 0,
    templateId: input.set.coverTemplateId,
    images: coverSlot ? { [coverSlot]: input.set.coverPhotoId } : {},
    texts: { ...input.coverTexts },
  };
  const ending: Page = {
    pageIndex: 0,
    templateId: input.set.endingTemplateId,
    images: Object.fromEntries(
      endingSlotIds.map((slotId, i) => [slotId, endingPool[Math.min(i, endingPool.length - 1)]]),
    ),
    texts: { ...input.endingTexts },
  };
  const ordered = [cover, ...input.interiorPages, ending].map((page, idx) => ({
    ...page,
    pageIndex: idx,
  }));
  // C 方案:carrier sweep 改了 texts,已烘的 html 失效 —— 清掉重烘,设计结果
  // (字体/颜色/封面封尾文案)烘进页面真相。lenient 为迁移过渡期(见 bake-html)。
  const inkByIndex = input.colorway
    ? darkInkByPageIndex(ordered, input.colorway, input.interiorSeed)
    : null;
  const swept = sweepCarriers(ordered, input.fonts, (page) => darkColorsOf(inkByIndex, page) ?? input.colors);
  const baked = bakePagesHtml(swept.map((page) => ({ ...page, html: undefined }))) as Page[];
  return inkByIndex
    ? applyDarkChrome(baked, inkByIndex)
    : applyPageBackground(baked, input.pageBackground);
}

/** 逐页深色墨:bg 刷页根,其余三键喂 sweepCarriers。 */
export type DarkInkForPage = {
  bg: string;
  /** 标题色(内页是 accent 亮字,封面是 colorway.title) */
  title: string;
  /** 正文/说明色 */
  body: string;
  /** 装饰槽色(内页跟标题,封面/封尾走 colorway.sub) */
  decoration: string;
};

/**
 * 第三套的逐页配色:封面/封尾用这本书的 colorway,内页按 seed 派的**确定性随机**序列
 * 逐页刷(有放回,同色可重复出现、相邻也可同色)。此前是三组按出现顺序循环,规律太明显、
 * 色也太接近,换成随机。
 * 深色套不留白页:满版图页染了也基本看不见,但书里插一页纯白像漏印,故一律上底色。
 *
 * seed 缺省 ⟺ 老书:本次改动之前成稿的第三套书,draft 里没有 design.interiorSeed,
 * 而页面 html 里烘死的是老三色表。这种书追加页要走 legacyInteriorInkSequence ——
 * 按新五色派色的话,新页会是淡黄或橙,插在一本深蓝/深墨绿的书里像另一本书的页。
 *
 * 追加照片那条路(job-service.mergeAppendLayoutPages)也要用它,所以导出:新页必须
 * 跟全书用同一个 seed、同一个页序口径,自己另算一份迟早会算歪。
 */
export function darkInkByPageIndex(
  ordered: Page[],
  colorway: CoverColorway,
  interiorSeed?: string,
): Map<number, DarkInkForPage> {
  const interiorCount = ordered.filter(
    (page) => templateCategory(page.templateId) === 'interior',
  ).length;
  // 一次性派满全书内页 —— 两条路都保证前缀稳定(新书靠 interiorInkSequence 的逐项
  // 纯函数,老书靠 i % 3),所以追加页把长度撑长之后,前面已成书那些页拿到的还是
  // 原来那个色。
  const sequence = interiorSeed
    ? interiorInkSequence(interiorSeed, interiorCount)
    : legacyInteriorInkSequence(interiorCount);
  const out = new Map<number, DarkInkForPage>();
  let i = 0;
  for (const page of ordered) {
    if (templateCategory(page.templateId) === 'interior') {
      const ink = sequence[i]!;
      // 内页:accent 给 title/decoration,body 给 body/explain(THIRD_SET_INTERIOR 的契约;
      // 两色字方案下这两个值相等,但键的语义不变,别合并)。
      out.set(page.pageIndex, {
        bg: ink.bg,
        title: ink.accent,
        body: ink.body,
        decoration: ink.accent,
      });
      i += 1;
    } else {
      // 封面/目录/封尾:用 colorway,整本书三张同色收口(小雨拍板 2026-08-28)。
      // 目录页(toc)走的就是这一支 —— 注意成稿时 mergeComposeIntoDraft 会按
      // category==='interior' 过滤内页、只重拼 [封面,...内页,封尾],目录页当场被丢掉,
      // 所以线上成品书目前根本没有目录页。这一支对它是「等目录页修回来就自动生效」。
      // decoration 走 sub 而不是 title ——
      // CoverColorway 的契约写着 sub 是「副标题 / 竖排系列名 / 底部署名」色,mag-62 的
      // label/label2/label3 三个 decoration 槽正是这三样东西,跟标题变粉就不是设计稿了。
      out.set(page.pageIndex, {
        bg: colorway.bg,
        title: colorway.title,
        body: colorway.sub,
        decoration: colorway.sub,
      });
    }
  }
  return out;
}

/** 某页的深色三键(没有深色墨 → null,调用方回落全书统一色)。 */
export function darkColorsOf(
  inkByIndex: Map<number, DarkInkForPage> | null | undefined,
  page: Page,
): DesignColors | null {
  const ink = inkByIndex?.get(page.pageIndex);
  if (!ink) return null;
  return { title: ink.title, body: ink.body, explain: ink.body, decoration: ink.decoration };
}

/** 页根同时刷底色和默认字色 —— 模板根写死 color:#1c1b18,深底上不翻浅的话,
 *  非 carrier 的静态装饰(页码、斜杠、分隔符)会黑压黑看不见。
 *
 *  同时把 ink.bg 写进 texts[PAGE_BACKGROUND_CARRIER_KEY]:深色套的底色是
 *  colorway/interiorInkSequence 动态派的,不是模板自带(design-agent 那张
 *  TEMPLATE_OWN_BACKGROUND 只兜得住 mag-62/63/p01 的 CSS 默认深底,兜不住这里)——
 *  不写 carrier,Agent 后续 set_text_colors 对这页做对比度校验时会拿错底色
 *  (可能是完全不同明暗的默认值),c3ce69b3 那道硬校验对刚成稿的深色套书就形同虚设。 */
export function applyDarkChrome(
  pages: Page[],
  inkByIndex: Map<number, { bg: string; body: string }>,
): Page[] {
  return pages.map((page) => {
    const ink = inkByIndex.get(page.pageIndex);
    if (!ink || typeof page.html !== 'string') return page;
    const patched = patchHtmlPageStyle(page.html, {
      'background-color': ink.bg,
      color: ink.body,
    });
    if (!patched) return page;
    return {
      ...page,
      html: patched,
      texts: { ...page.texts, [PAGE_BACKGROUND_CARRIER_KEY]: ink.bg },
    };
  });
}

// 书页底色 sweep:烘完 html 后,给每页页根 [data-template] 写 background-color,
// 同时把同一个 hex 写进 texts[PAGE_BACKGROUND_CARRIER_KEY](与手动书页背景工具同一
// 原语 patchHtmlPageStyle,纯字符串实现,服务端可跑)。carrier 是重烘才拿得回来的
// 那一份 —— Agent 之后 set_text_colors 重烘这页时,只有 inline 那份的话颜色就丢了。
// 纯白/未传 = 两者都不写(留模板自带 background:#fff,对老书纯叠加);
// 锚点失配的页原样保留(不影响其余页)。
// 导出给追加路径:重烘会把页根打回模板默认白,不重刷一遍新页就跟全书不同底。
export function applyPageBackground(pages: Page[], bg?: string): Page[] {
  if (!bg || isDefaultPageBackground(bg)) return pages;
  return pages.map((page) => {
    if (typeof page.html !== 'string') return page;
    const patched = patchHtmlPageStyle(page.html, { 'background-color': bg });
    if (!patched) return page;
    return { ...page, html: patched, texts: { ...page.texts, [PAGE_BACKGROUND_CARRIER_KEY]: bg } };
  });
}
