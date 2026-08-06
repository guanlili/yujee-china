# PDF 导出版式选择弹窗(合并双按钮)设计

日期:2026-08-06
分支:feat/collab-editing(叠在 2026-08-03 出血设计之上)
状态:用户已确认(双端一起改;默认选中标准版)

## 背景

2026-08-03 出血功能上线后,导出菜单里出现两个并排的 PDF 按钮
(「整本 PDF」/「印刷版 PDF · 含 3mm 出血」)。用户拍板:合并成
一个「整本 PDF」按钮,点开后弹「选版式」弹窗,交互参照现有
Live 图样式选择弹窗。

## 交互

1. 导出菜单只留一个「整本 PDF」按钮(印刷版按钮删除)。
2. 点「整本 PDF」→ 打开「PDF 版式」弹窗:
   - 左卡片「标准版」:屏幕查看、分享用。**默认选中**。
   - 右卡片「印刷版 · 3mm 出血」:四边各加 3mm 出血,供印刷厂
     裁切;页面尺寸相当于 216×303mm。
   - 卡片示意图为静态 SVG:标准版=单页;印刷版=单页外圈虚线
     出血框。
   - 底部「继续导出」:标准版走原 exportPdf 路径,印刷版走原
     exportPdfBleed(bleedMm=3)路径。
3. 双端一致:移动端(ExportModals)与桌面端(EditorPort)同步。

## 实现要点

- **零新增 CSS**:复用 Live 图弹窗那套 `nine-grid-choice` /
  `collage-confirm` / `collage-close` 现有类(两端共用同一样式表,
  这正是 ModalHost 的存在理由)。
- **导出管线零改动**:出血换算(extend-canvas-edges)、bleedMm
  参数、文件名后缀、出血版跳过云端上传,全部不动。本次纯 UI
  入口重组。
- 移动端:ExportModals.tsx 新增 PdfStyleModal;弹窗状态(pdfStyleOpen/
  pdfStyle)与 Live 样式一样放 MobileEditorRoot,use-export.ts 零改动
  (它只透传 bleedMm,出血值 3 仍只在确认分派层出现)。
- 桌面端:EditorPort.tsx 导出菜单按钮 data-action 从 exportPdf 改为
  openPdfStyle;新增弹窗 markup(id=pdfStyleModal)与
  data-pdf-style / confirmPdfStyle 接线,确认后按选中版式分派到
  既有 exportPdf / exportPdfBleed 处理函数。
- 测试:更新 pdf-bleed-wiring.test.ts、modals.test.ts、
  export-cloud-upload-silent.test.ts 对旧入口的引用;新增弹窗
  默认选中与两条分派路径的测试。

## 不做

- 不改导出闸门逻辑(印刷版与标准版同一把闸)。
- 不做「记住上次选择」;每次打开都默认标准版。
- 不动多跨页拼图 / Live 图 / 单页 JPG 三个入口。
