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

export function effectiveRenderVersion(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): string {
  const filter = resolveEffectiveFilter(state, photoId);
  if (!filter) return 'pf-v1__original';

  return `pf-v1__${filter.lutId}__${quantizeStrength(filter.strength)}`;
}
