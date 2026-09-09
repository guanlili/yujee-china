import { z } from 'zod';

export const LUT_DEFINITIONS = [
  { id: 'cloudy-cool', nameZh: '阴天清冷', source: '阴天清冷-709.cube' },
  { id: 'street-negative', nameZh: '街拍负片', source: '街拍负片-709.cube' },
  { id: 'airy-japanese', nameZh: '清透日系', source: '清透日系-709.cube' },
  { id: 'travel-cinematic', nameZh: '旅行大片', source: '旅行大片-709.cube' },
  { id: 'city-street', nameZh: '城市街头', source: '城市街头-709.cube' },
  { id: 'daily-soft', nameZh: '日常淡雅', source: '日常淡雅-709.cube' },
  { id: 'teal-orange-outdoor', nameZh: '青橙外景', source: '青橙外景-709.cube' },
  { id: 'cool-cyan', nameZh: '冷青氛围', source: '冷青氛围-709.cube' },
  { id: 'rich-teal-orange', nameZh: '浓郁青橙', source: '浓郁青橙-709.cube' },
  { id: 'fuji-portrait', nameZh: '富士人像', source: '富士人像-709.cube' },
  { id: 'night-film', nameZh: '夜景胶片', source: '夜景胶片-709.cube' },
  { id: 'forest-green', nameZh: '森系绿调', source: '森系绿调-709.cube' },
  { id: 'retro-film', nameZh: '复古胶片', source: '复古胶片-709.cube' },
  { id: 'fuji-clear', nameZh: '富士清透', source: '富士清透-709.cube' },
  { id: 'dark-cool-cinema', nameZh: '暗调冷电影', source: '暗调冷电影-709.cube' },
  { id: 'kodak-daylight', nameZh: '柯达日光胶片', source: '柯达日光胶片-709.cube' },
  { id: 'eighties-retro', nameZh: '八十年代复古', source: '八十年代复古-709.cube' },
  { id: 'sunny-soft', nameZh: '暖阳淡雅', source: '暖阳淡雅-709.cube' },
  { id: 'autumn-warm', nameZh: '秋日暖调', source: '秋日暖调-709.cube' },
  { id: 'altay-wilderness', nameZh: '阿勒泰旷野', source: '阿勒泰旷野-709.cube' },
  { id: 'warm-cinema-film', nameZh: '暖调电影胶片', source: '暖调电影胶片-709.cube' },
  { id: 'muted-cinema', nameZh: '低饱和电影', source: '低饱和电影-709.cube' },
  { id: 'nostalgic-film', nameZh: '怀旧胶片', source: '怀旧胶片-709.cube' },
  { id: 'kodak-2383', nameZh: '影院质感2383', source: '影院质感2383-709.cube' },
  { id: 'fresh-clear', nameZh: '清新通透', source: '清新通透-709.cube' },
  { id: 'green-book', nameZh: '绿皮书质感', source: '绿皮书质感:复古:雪山:人像:风光.cube' },
] as const;

const ids = LUT_DEFINITIONS.map((x) => x.id) as [string, ...string[]];
export const LutIdSchema = z.enum(ids);
export type LutId = z.infer<typeof LutIdSchema>;

export const PhotoFilterRefSchema = z.object({
  lutId: LutIdSchema,
  strength: z.number().min(0).max(100),
}).strict();
export type PhotoFilterRef = z.infer<typeof PhotoFilterRefSchema>;

export const PhotoFilterStateSchema = z.object({
  default: PhotoFilterRefSchema.nullable(),
  overrides: z.record(z.string(), PhotoFilterRefSchema.nullable()).optional(),
  // 抠图与 LUT 同属「每张照片的派生像素状态」,所以共用 albums.photo_filter 这一列:
  // 一个真相源、一次行锁、一个 normalize,且不动 Page 契约、不加迁移。
  // 只认 true —— 关掉抠图是删键。允许 false 会让「没抠」有两种表示,
  // renderVersion 和派生缓存 key 立刻产生歧义。
  // 没有 album 级默认值:不存在「整本每张都抠」这种需求,只有 per-photo。
  cutouts: z.record(z.string(), z.literal(true)).optional(),
}).strict();
export type PhotoFilterState = z.infer<typeof PhotoFilterStateSchema>;

export function quantizeStrength(value: number): number {
  return Math.round(value / 5) * 5;
}

function normalizeFilterRef(filter: PhotoFilterRef | null): PhotoFilterRef | null {
  return filter && { ...filter, strength: quantizeStrength(filter.strength) };
}

export function normalizePhotoFilterState(
  state: PhotoFilterState | null | undefined,
): PhotoFilterState | null {
  if (state == null) return null;

  const overrides = state.overrides && Object.fromEntries(
    Object.entries(state.overrides).map(([photoId, filter]) => [photoId, normalizeFilterRef(filter)]),
  );

  return {
    default: normalizeFilterRef(state.default),
    ...(overrides && { overrides }),
    // cutouts 没有可归一化的量(只有 true),但必须原样带过去 —— 归一化时丢掉它
    // 等于用户一改滤镜就把抠图状态清了。
    ...(state.cutouts && { cutouts: state.cutouts }),
  };
}

export function resolveEffectiveFilter(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): PhotoFilterRef | null {
  if (state?.overrides && Object.prototype.hasOwnProperty.call(state.overrides, photoId)) {
    return state.overrides[photoId] ?? null;
  }

  return state?.default ?? null;
}

/**
 * 开/关某张照片的抠图。**关掉是删键,不是写 false** —— 契约里 cutouts 只认 true,
 * 允许 false 会让「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义。
 * 全关之后连 cutouts 这个壳一起删掉,免得存库 JSON 里留一个空对象。
 */
export function toggleCutout(
  state: PhotoFilterState,
  photoId: string,
): PhotoFilterState {
  const next = { ...(state.cutouts ?? {}) };
  if (next[photoId]) delete next[photoId];
  else next[photoId] = true;

  const { cutouts: _dropped, ...rest } = state;
  return Object.keys(next).length > 0 ? { ...rest, cutouts: next } : rest;
}

export function isCutout(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): boolean {
  return state?.cutouts?.[photoId] === true;
}

// 抠图**追加尾段**,不升 pf-v2。升版本号会让所有存量快照的 renderVersion 一次性
// 失配,每个已分享的相册都撞 409 PHOTO_SNAPSHOT_VERSION_MISSING,用户得重备全书。
// 追加尾段则让未抠图的版本串逐字节不变。
export function effectiveRenderVersion(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): string {
  const filter = resolveEffectiveFilter(state, photoId);
  const cut = isCutout(state, photoId) ? '__cut1' : '';
  if (!filter) return `pf-v1__original${cut}`;

  return `pf-v1__${filter.lutId}__${quantizeStrength(filter.strength)}${cut}`;
}

/** 键序无关的深比较用的规范化序列化(overrides/cutouts 的键序由合并顺序决定,
 *  不该影响「变没变」的判定)。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

/**
 * 两份滤镜状态**语义**上是不是同一份。先过 normalizePhotoFilterState 再比 ——
 * strength 52 与 50 归一后同值,不该被当成一次改动。
 *
 * 为什么需要它:滤镜写入会**无条件**清 PDF/封面派生物并把 COMPLETED 打回 EDITING。
 * 不判「真的变了没有」的话,用户再问一句「确认下调色」,PDF 链接和封面缩略图就凭空
 * 消失了(design-agent 侧有同名函数,那边只用来压 warning,不管写不写)。
 */
export function photoFilterStatesEqual(
  a: PhotoFilterState | null | undefined,
  b: PhotoFilterState | null | undefined,
): boolean {
  return stableStringify(normalizePhotoFilterState(a)) === stableStringify(normalizePhotoFilterState(b));
}
