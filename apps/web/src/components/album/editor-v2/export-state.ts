// 导出域的状态对象(2026-11-11,拆 EditorBook 的阶段 2a)。
//
// 为什么需要它:`exportPdf` 那一簇函数靠 6 个**模块级 let** 互相协调 ——
//   exportGateLocked  门闩:未解锁不许导出(chat 侧也能关它)
//   exportingPdf      防重入(导出中再点一次没反应)
//   exportingImages   防重入(逐页导出 PNG 与 PDF 互斥)
//   exportBleedMm     本次导出的出血量(0 = 标准版)
//   didLocalDownload  是否已经吐过文件(决定是否还能重试)
//   pdfStyle          版式弹窗的当前选择
// 它们散在 5,700 行里、被 35 处读写,谁都能改 —— 搬函数时这些就是"拖不动的部分"。
// 收进一个对象后,阶段 2b 搬 exportPdf 主路径只需要注入这一个引用。
//
// **语义与原子符串一一对应**,没有任何隐藏状态或默认值差异:初始值完全照抄。
// 别把它当全局单例用 —— 每次挂载建一个新的,和原来 effect 内的 let 生命周期一致。

export type PdfStyle = 'standard' | 'bleed';

export type ExportState = {
  /** 门闩。authoring 模式下初始就是锁的,直到服务端说可以导。 */
  gateLocked: boolean;
  /** 导出 PDF 进行中(防重入,同时拦住逐页 PNG 导出)。 */
  exportingPdf: boolean;
  /** 逐页导出 PNG 进行中。 */
  exportingImages: boolean;
  /** 本次导出的出血毫米数;0 = 标准版(也决定要不要上传云端)。 */
  bleedMm: number;
  /** 是否已经触发过本地下载。 */
  didLocalDownload: boolean;
  /** 版式弹窗当前选择。 */
  pdfStyle: PdfStyle;
};

export function createExportState(isAuthoring: boolean): ExportState {
  return {
    // 原:let exportGateLocked = isAuthoring; —— authoring 入口默认锁门(§4.5a)。
    gateLocked: isAuthoring,
    exportingPdf: false,
    exportingImages: false,
    bleedMm: 0,
    didLocalDownload: false,
    pdfStyle: 'standard',
  };
}
