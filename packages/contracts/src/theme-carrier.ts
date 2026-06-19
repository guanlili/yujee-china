import { TemplateTextRole } from './templates';

/**
 * V3 theme-carrier 约定(WP5.1 / §3 树边界 单一真相源)。
 *
 * 背景:每章一个 `{accentColor, artFont}` 主题(§6 章级粒度)。finalize 把它烘焙进
 * 扁平 `Page.texts`(`Record<string,string>`)。扁平渲染契约**绝不新增树形字段**
 * (§3 树边界),所以章节色/字体只能借 `texts` 这一 string map 携带 —— 用一组
 * **magic key 文法**而不是新字段。本文件是该文法的**单一真相源**:finalize(烘焙端)
 * 与渲染器(消费端)都从这里取约定,而不是各自「考古」`finalize_v3.py` 的私有常量。
 *
 * 约定(由 `_bake_variable_decor` 烘焙、`validate_v3` 校验、渲染器消费):
 *   ① **SVG variableDecor 槽 —— 值即色(自包含)**:`texts[slotId]` 的值
 *      *本身就是* 章节 accentColor。矢量由渲染器以该色绘制。无 sibling key。
 *   ② **TEXT variableDecor 槽 —— sibling carrier 键**:槽内容(用户标题、date/folio
 *      这类 code-owned 值、空字符串、或缺省状态)**逐字保留**,章节色/字体改走兄弟键
 *      `texts[slotId + ACCENT_CARRIER_SUFFIX]` /
 *      `texts[slotId + FONT_CARRIER_SUFFIX]`,内容永不被覆盖。
 *   ③ **零碰撞**:真实 slotId 是普通 id 或 bracket-path(`cells[0].image`、`caption[0]`),
 *      均不含 `#`;carrier 后缀以 `#` 起头,故 carrier 键与任何声明的真实 slotId 不会撞。
 *   ④ **幂等覆盖**:finalize 对同一棵树重复烘焙得到逐字节相同的 `texts` —— 覆盖
 *      carrier / 值即色,**绝不追加**。
 */

/** Sibling-carrier 后缀:章节 accentColor 落 `texts[slotId + 此后缀]`(约定 ②)。 */
export const THEME_ACCENT_CARRIER_SUFFIX = '#accentColor';

/** Sibling-carrier 后缀:章节 artFont 落 `texts[slotId + 此后缀]`(约定 ②)。 */
export const THEME_FONT_CARRIER_SUFFIX = '#artFont';

/**
 * 文字槽 role 中「持用户散文」的子集 —— 其 `texts[slotId]` 内容**绝不被主题色覆盖**;
 * 主题改走 sibling carrier(约定 ②)。`decoration` text 槽同样保留自身内容/空值,
 * 主题只走 sibling carrier;只有 SVG variableDecor 槽走「值即色」(约定 ①)。
 *
 * **从 `TemplateTextRole` 枚举派生**(全部 role 减去 `decoration`),而非硬写字面量集合:
 * 将来枚举新增第 4 个正文 role 时,这里**自动**纳入,无需两处改。
 */
export const THEME_USER_PROSE_ROLES: ReadonlySet<TemplateTextRole> = new Set(
  TemplateTextRole.options.filter((role) => role !== 'decoration'),
);
