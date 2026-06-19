// Pure 导出闸门逻辑(WP5.2 / §4.5a),split out of EditorPort.tsx so it can be
// unit-tested under `tsx --test` without importing the JSX/React component tree
// (same pattern as stage-breadcrumb-util.ts / zoom-util.ts).
//
// 真相源 = WP2.4 的 exportUnlocked 口径(album-service.getStoryProgress):导出解锁
// ⇔「章节故事」全部章节完成(allDone)且 albums.stage 已推进过 'story'。主题(theme)/
// 封面(cover)不作为闸门——它们都在 story 之后,所以一旦解锁就不会再被重新锁上,
// 跳过主题/封面也不影响导出(§4.5a)。这里只是把同一公式复用到前端按钮显隐,
// 不另造一套口径,也不在前端改写 stage(stage 推进权在 Web,§8.3)。
//
//   分析 analysing  → 锁
//   章节故事 story   → 锁
//   确定主题 theme   → 开
//   书籍设计 cover   → 开
//   待导出 ready     → 开
//
// 实现刻意与 album-service.ts 的 `allDone && stage !== 'analysing' && stage !==
// 'story'` 同义 —— 复用 WP2.4 的口径,不另造一套闸门。唯一的额外护栏:前端 detail.album.stage
// 类型是 string | undefined(服务端那侧 album.stage 永远是合法 enum),所以缺失/空
// stage 当作未解锁(没相册 = 不放行);任何非空 stage 字符串都按 WP2.4 公式判定
// (即只有 'analysing' / 'story' 锁,其余开),与服务端真值表逐项一致。

const LOCKED_STAGES = new Set(['analysing', 'story']);

export function computeExportUnlocked(stage: string | undefined | null, allDone: boolean): boolean {
  if (!allDone) return false;
  if (!stage) return false; // 缺失/空 stage:没相册可导出
  return !LOCKED_STAGES.has(stage); // 镜像 WP2.4:stage ∉ {analysing, story} ⇒ 解锁
}
