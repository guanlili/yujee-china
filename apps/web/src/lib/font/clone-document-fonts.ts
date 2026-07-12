'use client';

// html2canvas(-pro) 截图前会把页面克隆进离屏 iframe 重新布局测量;<style> 里的规则
// 会被带过去,但通过 document.fonts.add() 动态安装的字体(相册 CJK 子集,见
// album-font-loader)不会 —— 克隆文档用回退字体测字宽、画布上又用真字体画字,
// 词距系统性错位(实测:英文正文词与词粘连重叠,导出 PDF 不可读)。
// 所以每个 html2canvas 调用点都必须在 onclone 里调这个函数:把主文档的动态字体
// 注入克隆文档并等它就绪(数据同源 data: URI,浏览器有缓存,等待近乎零开销)。
// onclone 返回的 Promise 会被 html2canvas await(布局发生在其后),时序安全。
export async function injectDocumentFontsInto(clonedDoc: Document): Promise<void> {
  try {
    const source = document.fonts as unknown as Iterable<FontFace> | undefined;
    const target = clonedDoc.fonts as unknown as { add(face: FontFace): unknown; ready?: Promise<unknown> } | undefined;
    if (!source || !target) return;
    for (const face of source) {
      try {
        target.add(face);
      } catch {
        // 个别引擎拒绝跨文档 add:跳过该字体,剩下的照常注入(降级为原状,不炸截图)。
      }
    }
    await target.ready;
  } catch {
    // 字体注入失败不阻塞截图 —— 退回修复前的行为(可能词距错位),但至少能出图。
  }
}
