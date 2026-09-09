/* 对话历史回放的**唯一口径**。
   「哪些行算历史、每行带什么」必须只有一份 —— 否则同一段对话在不同壳里长得不一样,
   用户在响应式分叉点两侧来回一次就以为历史丢了。规则在这里,渲染在消费方。
   (2026-08-03 起移动端也挂桌面 ChatPanel,消费方只剩它;这份口径仍单独成文件,
   一是单测直取,二是防止下一个「第二套对话壳」再把规则抄歪。) */

/** Agent 巡检页面时写进消息表的内部行,不是对话内容。 */
const INSPECTION_PREFIX = '[inspection of page';

export type ChatRole = 'user' | 'assistant';

/** design chat 写类操作折成的用户可读类别。 */
export type DesignChangeCategory = 'fonts' | 'colors' | 'pages' | 'order';

/** 十三个写工具 → 类别。与 design-chat 路由落库 designOps 的工具名一一对应。
 *
 * set_page_background / apply_book_style(2026-08-29 风格理解新增)都映射到 'colors' ——
 * 前者就是逐页刷底色,后者虽然也换封面/封尾模板,但用户视角「整本换气质」最显眼的效果
 * 是全书底色和字色一起变,归进颜色条比归进「页面」更贴用户心智,也不必为这两个工具
 * 新开一个类别、多一套要审的展示文案。 */
const DESIGN_CHANGE_CATEGORY: Record<string, DesignChangeCategory> = {
  set_text_fonts: 'fonts',
  set_text_colors: 'colors',
  set_page_background: 'colors',
  apply_book_style: 'colors',
  update_page_texts: 'pages',
  swap_page_template: 'pages',
  update_page_images: 'pages',
  write_page_html: 'pages',
  move_pages: 'order',
  delete_page: 'pages',
  // 2026-09-09 照片视觉档案那批。**不新开类别** —— 加一类会在 ChatPanel:844 那组
  // 硬编码中英文案里产生新的英文 key,跟 i18n overlay(以英文原文为 key)撞车。
  // set_image_pos 改的是照片在框里的位置 → 用户视角就是「这页变了」;
  // set_photo_cutout 抠掉背景同理,是页面观感变化,不是换颜色;
  // set_photo_filter 是逐张/整本调色 → 'colors',与 set_page_background 同理。
  // look_at_photos 是读工具,**不进这张表** —— 它不改任何东西,进来会造出假改动。
  set_image_pos: 'pages',
  set_photo_filter: 'colors',
  set_photo_cutout: 'pages',
};

/** 固定展示顺序,不随工具调用顺序抖动。 */
const DESIGN_CHANGE_ORDER: readonly DesignChangeCategory[] = ['fonts', 'colors', 'pages', 'order'];

/** 类别去重 + 固定顺序。 */
export function orderedChangeCategories(
  cats: Iterable<DesignChangeCategory>,
): DesignChangeCategory[] {
  const set = cats instanceof Set ? cats : new Set(cats);
  return DESIGN_CHANGE_ORDER.filter((c) => set.has(c));
}

/** 从落库的 layout_patch 里解析 design chat 写操作({ designOps: [{toolName, input}] })。 */
export function readDesignOps(layoutPatch: unknown): Array<{ toolName: string; input?: unknown }> {
  if (!layoutPatch || typeof layoutPatch !== 'object') return [];
  const ops = (layoutPatch as { designOps?: unknown }).designOps;
  if (!Array.isArray(ops)) return [];
  return ops.filter(
    (op): op is { toolName: string; input?: unknown } =>
      !!op &&
      typeof op === 'object' &&
      typeof (op as { toolName?: unknown }).toolName === 'string',
  );
}

/** 单个工具名 → 类别(非写/未知工具返回 undefined)。桌面流式逐事件判类别用。 */
export function designChangeCategoryOf(toolName: string): DesignChangeCategory | undefined {
  return DESIGN_CHANGE_CATEGORY[toolName];
}

export function designOpCategories(toolNames: Iterable<string>): DesignChangeCategory[] {
  const set = new Set<DesignChangeCategory>();
  for (const name of toolNames) {
    const cat = DESIGN_CHANGE_CATEGORY[name];
    if (cat) set.add(cat);
  }
  return orderedChangeCategories(set);
}

/** GET /api/v1/albums/{uuid}/messages 的行(见 chatService.listMessages)。 */
export type HistoryRow = {
  id: string;
  role: string;
  content: string;
  layoutPatch?: unknown;
};

export type ChatHistoryItem = {
  id: string;
  role: ChatRole;
  text: string;
  /** 这条 AI 回复改了哪几类东西(空数组 = 没动手,只说话)。 */
  changes: DesignChangeCategory[];
};

/**
 * 服务端历史 + 本地还没落库的消息。
 *
 * 为什么不能直接用服务端那份覆盖:design chat 一轮可能跑到 120s,落库发生在 done 事件。
 * 在那之前用户发出去的话只活在本地,整体覆盖会让它当场消失。反过来,落库之后再拉历史,
 * 同一条会在两边都有 —— 本地 id 是 `local-N`、服务端是真 id,认不出是同一条,所以按
 * (role, text) 判重。
 *
 * 判重按**条数配对**而不是集合成员:用户连说两次「再来一次」、而只有第一条落了库时,
 * 集合判重会把本地两条一起滤掉 —— 又变成静默丢消息。
 */
export function mergeChatHistory(
  server: readonly ChatHistoryItem[],
  local: readonly ChatHistoryItem[],
): ChatHistoryItem[] {
  const key = (m: ChatHistoryItem) => `${m.role} ${m.text}`;
  const quota = new Map<string, number>();
  for (const m of server) quota.set(key(m), (quota.get(key(m)) ?? 0) + 1);
  const pending = local.filter((m) => {
    const left = quota.get(key(m)) ?? 0;
    if (left <= 0) return true; // 服务端没有(或已配对完)→ 这条还没落库,留着
    quota.set(key(m), left - 1);
    return false;
  });
  return [...server, ...pending];
}

/** 把消息表的行折成可渲染的历史条目。 */
export function buildChatHistory(rows: readonly HistoryRow[]): ChatHistoryItem[] {
  const out: ChatHistoryItem[] = [];
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const text = (row.content ?? '').trim();
    if (!text) continue;
    if (text.startsWith(INSPECTION_PREFIX)) continue;
    out.push({
      id: row.id,
      role: row.role,
      text,
      changes:
        row.role === 'assistant'
          ? designOpCategories(readDesignOps(row.layoutPatch).map((op) => op.toolName))
          : [],
    });
  }
  return out;
}
