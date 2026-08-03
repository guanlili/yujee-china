/* ════════════════════════════════════════════════════════════════════════════
   color-recent —— 取色器「最近使用」颜色的列表逻辑与本机存取。

   记账口径(2026-08-03 用户拍板,截图指定):Fill 取色器预设一排的下方多一排
   「最近使用」。只在**关面板那一刻**记当次的最终色 —— 拖拽取色每帧都 emit,
   逐次记会把 6 个位置刷成同一次拖拽的渐变噪音;开了面板没选色就关不记;
   「无背景」是清除不是选色,也不记(调用方负责这两条判定,这里只管列表与存取)。

   存 localStorage(本机偏好,不进库):去重、最新在前、封顶 6 个(恰好一排)。
   ════════════════════════════════════════════════════════════════════════════ */

export const RECENT_COLORS_MAX = 6;
export const RECENT_COLORS_KEY = 'yujee:recent-colors';

/** 纯列表逻辑:归一化(小写去空白)、去重、插到最前、封顶。 */
export function pushRecentColor(
  list: readonly string[],
  css: string,
  max = RECENT_COLORS_MAX,
): string[] {
  const norm = css.trim().toLowerCase();
  if (!norm) return list.slice(0, max);
  return [norm, ...list.filter((c) => c !== norm)].slice(0, max);
}

/** 读本机列表。localStorage 不可用(SSR/隐私模式)或内容损坏时回空,不抛。 */
export function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_COLORS_MAX);
  } catch {
    return [];
  }
}

/** 记一笔并落盘,返回新列表。写失败(配额/隐私模式)静默 —— 最近色是锦上添花,不挡选色。 */
export function saveRecentColor(css: string): string[] {
  const next = pushRecentColor(loadRecentColors(), css);
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    /* 静默 */
  }
  return next;
}
