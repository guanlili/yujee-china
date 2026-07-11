// Pure 导出闸门逻辑,split out of EditorPort.tsx so it can be unit-tested under
// `tsx --test` without importing the JSX/React component tree (same pattern as
// zoom-util.ts).
//
// 2026-07 设计环节收紧:导出解锁 ⇔「章节故事」全部章节完成(allDone)且设计已完成
// (albums.stage === 'ready';'ready' 由 applyDesign 成功后推进)。主题(theme)/封面
// (cover)阶段不再解锁 —— 没做封面封尾/字体文案设计就不能导 PDF。
//
//   分析 analysing  → 锁
//   章节故事 story   → 锁
//   确定主题 theme   → 锁(设计未完成)
//   书籍设计 cover   → 锁(设计未完成)
//   待导出 ready     → 开(allDone 前提下)
//
// 口径与 album-service.storyProgressFrom 的 `allDone && stage === 'ready'` 完全同义,
// 两处同改,不另造一套闸门;stage 推进权在 Web 服务端,前端不改写 stage。缺失/空/未知
// stage 一律锁(没相册 = 不放行)。追加照片期间新章节未完成会令 allDone=false,导出
// 自动重新上锁,追加排版完成(新章记 done)后自动恢复。
export function computeExportUnlocked(stage: string | undefined | null, allDone: boolean): boolean {
  return allDone && stage === 'ready';
}
