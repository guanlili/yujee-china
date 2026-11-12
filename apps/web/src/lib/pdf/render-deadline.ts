// 整本 PDF 栅格渲染的兜底期限。
//
// 单独成文件的原因:它必须能被**静态 import** 到导出入口里。
// 2026-11-09 线上第二次实测发现,真正卡住的不只是取图 —— `await import('@/lib/pdf/render-raster')`
// 本身也会挂住(该 chunk 请求在跨境弱网下 ERR_TIMED_OUT),而动态 import 一旦挂住,
// 包在它后面的 withDeadline 连执行都执行不到。期限常量必须握在手里,watchdog 才能
// 把整个「动态 import + 取图 + 栅格化」一起兜住。
export const RASTER_PDF_RENDER_DEADLINE_MS = 180_000;
