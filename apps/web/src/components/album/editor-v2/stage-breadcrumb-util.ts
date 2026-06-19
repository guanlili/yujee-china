// Pure 五环节面包屑逻辑(WP2.4),split out of StageBreadcrumb.tsx so it can be
// unit-tested under `tsx --test` without importing the JSX/React component tree
// (same pattern as zoom-util.ts). The component imports STAGE_ORDER +
// computeStagePills from here.

// The five 环节 in order — matches the contracts AlbumStage enum + the server's
// albums.stage column (architecture §6.8 第 4 条):
//   analysing → story → theme → cover → ready
export const STAGE_ORDER = ['analysing', 'story', 'theme', 'cover', 'ready'] as const;
export type StageKey = (typeof STAGE_ORDER)[number];

export type StagePillState = 'done' | 'active' | 'upcoming';

// Given the album's current stage, classify each of the five 环节 as
// done / active / upcoming. An unknown/missing stage falls back to the first 环节
// active (building albums report 'analysing').
export function computeStagePills(stage: string | undefined): {
  key: StageKey;
  state: StagePillState;
}[] {
  const idx = STAGE_ORDER.indexOf((stage ?? 'analysing') as StageKey);
  const activeIdx = idx < 0 ? 0 : idx;
  return STAGE_ORDER.map((key, i) => ({
    key,
    state: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'upcoming',
  }));
}
