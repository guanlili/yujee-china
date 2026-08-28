// 第三套(深色椭圆)的配色真相源。封面色和内页色**分开管** —— 封面是一整张
// 视觉主张,内页要顾及照片和长段落阅读,两者约束不同,不共用一张色表。
// 所有色值都过了对比度实测(见同目录 .test.ts),改色必须同步跑测试。

export const THIRD_SET_COVER_TEMPLATE_ID = 'mag-62';

export type CoverColorway = {
  id: string;
  name: string;
  nameEn: string;
  bg: string;
  /** 主标题色 */
  title: string;
  /** 副标题 / 竖排系列名 / 底部署名色 */
  sub: string;
};

/**
 * 全书只有两个字色(小雨拍板 2026-08-28):深底一律浅字,浅底一律深字。封面/目录/封底
 * 与内页共用这一条规则。
 *
 * 上一版是「按底色逐个派生字色」,被否了 —— 五个底色各配各的字色,整本书看着像
 * 五本不同的书拼起来的。两个字色是这一套的设计语言,改之前先问。
 */
export const THIRD_SET_INK = { light: '#F5F2E8', dark: '#1A1A14' } as const;

/**
 * 封面/目录/封底三张共用的配色(2026-08-28 小雨拍板:去掉深青,只用黄蓝红,整本书洗一次)。
 *
 * 底色沿用内页那三个同名色 —— 全书就一套色,封面和内页是同一个系统,不是两张表各走各的。
 * 字色同样走两色规则(见 THIRD_SET_INK):黄底配深字,蓝/红底配浅字,title 与 sub 同值。
 * `sub` 这个键**不能合并掉**:mag-62 的 label/label2/label3 三个 decoration 槽按契约读
 * 的是 sub 而不是 title,现在两者取值相同,不代表接线可以改。
 */
export const THIRD_SET_COVERS: readonly CoverColorway[] = [
  { id: 'butter', name: '黄', nameEn: 'Butter', bg: '#F3F0A8', title: THIRD_SET_INK.dark, sub: THIRD_SET_INK.dark },
  { id: 'blue', name: '蓝', nameEn: 'Blue', bg: '#2D6DB0', title: THIRD_SET_INK.light, sub: THIRD_SET_INK.light },
  { id: 'red', name: '红', nameEn: 'Red', bg: '#C83E18', title: THIRD_SET_INK.light, sub: THIRD_SET_INK.light },
];

/**
 * 换表前派给老书的四个配色。**只用于按 id 查回,不再派给新书。**
 *
 * 线上老书的 `draft.design.coverColorway` 里存的就是这四个 id。把它们删掉的话
 * `coverColorwayById` 返回 undefined → `assembleDesignedPages` 整条深色分支不走 →
 * 老书追加照片时新页刷成模板默认白底 + 深色书的浅字,实测 1.09:1,整页像没印上。
 * 这正是 coverColorway 当年栽过的那个坑,别为了"清理"把这张表删了。
 */
export const LEGACY_THIRD_SET_COVERS: readonly CoverColorway[] = [
  { id: 'teal', name: '深墨绿', nameEn: 'Deep Teal', bg: '#12363A', title: '#F0A4C2', sub: '#E7E3D8' },
  { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
  { id: 'pink', name: '粉', nameEn: 'Pink', bg: '#F0A4C2', title: '#1F3A24', sub: '#3A2B31' },
  { id: 'navy', name: '深蓝', nameEn: 'Navy', bg: '#0E2A47', title: '#F1EFE8', sub: '#C9D3DE' },
];

export const DEFAULT_COVER_COLORWAY_ID = THIRD_SET_COVERS[0]!.id;

/** 新表优先,查不到再翻老表(老书的 id 必须还认得,理由见 LEGACY_THIRD_SET_COVERS)。 */
export function coverColorwayById(id: string | null | undefined): CoverColorway | undefined {
  if (!id) return undefined;
  return (
    THIRD_SET_COVERS.find((c) => c.id === id) ?? LEGACY_THIRD_SET_COVERS.find((c) => c.id === id)
  );
}

/**
 * 第三套的配色由系统**确定性**派一个,不再让用户在选择卡里挑(产品决定 2026-08:
 * 不满意后续在编辑器里改)。按 albumId 派生 —— 与旁边 pageBackground 同一思路,
 * 也与 pickEndingTemplateId 同一个字符和取模。
 *
 * 绝不能用随机:同一本书每次拿封面组都要给出同一个配色,否则用户刷新一次封面换个颜色,
 * 那是 bug 不是惊喜(而且选择卡预览与最终成书会对不上)。
 */
export function coverColorwayForAlbum(albumId: string): CoverColorway {
  // 字符码求和取模:在 3 档上实测 60000 个 uuid 是 33.2/33.1/33.8,分布没问题,
  // 不需要像内页那样加雪崩(那里的病根是 pool 恒为 4、只读到哈希低 2 位)。
  const offset = [...albumId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % THIRD_SET_COVERS.length;
  return THIRD_SET_COVERS[offset]!;
}

/** 内页配色。accent 给 title/decoration,body 给 body/explain。 */
export type DarkInk = { id: string; bg: string; accent: string; body: string };

/**
 * 内页彩色底(五色,深浅混合,随机刷)。
 *
 * 前一版是三组「深底 + 荧光亮字」(#0E2A47/#12363A/#14140F 配 #B8FF3C/#F0A4C2),
 * 换掉的原因有两条:①三组都是深底加荧光,远看分不出来,等于单色;②荧光色四色印刷
 * 印不出来,要上专色油墨。现在这五个色全在四色色域内,实体书的成本账不用再单算。
 *
 * ⚠️ 色值不是随便填的,每一个都卡着 4.5:1(见同目录 .test.ts):
 *   · 橙原稿 #E8481C 配浅字 3.49、配深字 4.47 —— **两边都不达标**,压深到 #C83E18 才过;
 *   · 绿原稿 #139A56 配浅字 3.24,压深到 #107E47 才过(用户要绿配浅字);
 *   · 蓝 #2D6DB0 浅字 4.78,是唯一不用动就能配浅字的;
 *   · 淡黄 #F3F0A8 配浅字只有 1.05 —— 等于白纸,永远只能配深字。
 * 改任何一个色值都要重跑对比度测试,别凭眼睛判断。
 */
export const THIRD_SET_INTERIOR: readonly DarkInk[] = [
  { id: 'butter', bg: '#F3F0A8', accent: THIRD_SET_INK.dark, body: THIRD_SET_INK.dark },
  { id: 'violet', bg: '#9F82E8', accent: THIRD_SET_INK.dark, body: THIRD_SET_INK.dark },
  { id: 'orange', bg: '#C83E18', accent: THIRD_SET_INK.light, body: THIRD_SET_INK.light },
  { id: 'green', bg: '#107E47', accent: THIRD_SET_INK.light, body: THIRD_SET_INK.light },
  { id: 'blue', bg: '#2D6DB0', accent: THIRD_SET_INK.light, body: THIRD_SET_INK.light },
];

/**
 * 老书的内页三色表(本次改动前上线的第三套书,页面 html 里烘死的就是这三个色)。
 *
 * **它是历史事实,不是设计选择。** 线上老书的页面早已烘成这三色,改这张表 = 老书加照片
 * 时新页与老页对不上。别为了"统一"把它删掉或往里加色。
 *
 * 判据:`design.interiorSeed` 缺省 ⟺ 老书 —— 本次改动后两条派发路(applyDesign /
 * applyPlaceholderDesign)都必设种子,所以缺种子只可能是改动前成的稿。老书重新成稿会
 * 拿到种子并整本重烘成新五色,那时全书一致,也没问题。
 */
export const LEGACY_THIRD_SET_INTERIOR: readonly DarkInk[] = [
  { id: 'navy-lime', bg: '#0E2A47', accent: '#B8FF3C', body: '#E8E5DC' },
  { id: 'teal-pink', bg: '#12363A', accent: '#F0A4C2', body: '#E8E5DC' },
  { id: 'ink-lime', bg: '#14140F', accent: '#D4FF3F', body: '#E8E5DC' },
];

/** 老书的取色:按页序三色循环,与改动前逐项一致(唯一目的就是复刻旧行为)。 */
export function legacyInteriorInkSequence(count: number): readonly DarkInk[] {
  return Array.from(
    { length: count },
    (_, i) => LEGACY_THIRD_SET_INTERIOR[i % LEGACY_THIRD_SET_INTERIOR.length]!,
  );
}

/** FNV-1a:纯函数、跨进程稳定。别换成 Math.random 或任何带状态的实现,理由见下。 */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return fmix32(h);
}

/**
 * MurmurHash3 的收尾雪崩。**取模前必须过这一步,别省。**
 *
 * FNV-1a 的低位是个 4 状态自动机(乘数 0x01000193 ≡ 3 mod 4):`h_new 的低 2 位` 只由
 * `h 的低 2 位` 和 `这个字符的低 2 位` 决定,整条 seed 对低位的全部贡献就是把自动机推到
 * 4 个状态之一。而下面取模时 pool 排掉上一页后长度恒为 4 —— `% 4` 只读低 2 位,于是
 * 2 万本真书只派得出 4 种「第 3 页起」的排列,100% 的书里带 >=8 页的四色循环。
 * fmix32 把高位搅进低位,取模才拿到全部 32 位的熵。见 .test.ts 里那三条多样性守卫。
 */
function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * 内页底色序列:按 seed 派一串**确定性伪随机**的配色,每页从五色里独立抽(有放回)。
 *
 * 为什么不能用真随机 —— 这条路有两个调用方:成书主路(assembleDesignedPages)和
 * 追加照片(job-service.mergeAppendLayoutPages / mergeAppendComposeTexts)。追加那条
 * 只重刷新页,老页的颜色早烘死在 html 里了;两次调用结果不一样,加几张照片就把新页
 * 刷成跟全书不同的一套色。所以必须「同 seed 同长度 → 逐项相同」,而且**前缀稳定**
 * (长度从 10 变 13,前 10 项一个字节都不能动)。第 i 项只取决于 seed 和 i,前缀稳定
 * 因此是结构上成立的,不靠约定。
 *
 * **有放回,不去重**(小雨拍板 2026-08-28):同一个色在一本书里出现五六次是正常的,
 * 某个色一次都不出现也是正常的;相邻两页同色同样允许(约五分之一的概率)。曾经加过
 * 一条「相邻不撞色」,已按用户要求去掉 —— 别再"顺手"加回来,测试里钉着相邻同色的
 * 出现率,加回去会红。
 */
export function interiorInkSequence(seed: string, count: number): readonly DarkInk[] {
  return Array.from(
    { length: count },
    (_, i) => THIRD_SET_INTERIOR[hash32(`${seed}#${i}`) % THIRD_SET_INTERIOR.length]!,
  );
}
