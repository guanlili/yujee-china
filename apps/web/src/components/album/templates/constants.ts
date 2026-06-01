export const COLORS = {
  paper: '#f6f1e7',
  paper2: '#efe8d8',
  rule: '#d8cfbb',
  ruleLight: '#dcd8cf',
  ink: '#1c1b18',
  ink2: '#5a574f',
  ink3: '#a09b8e',
  vermilion: '#b04a2f',
  vermilionSoft: '#d27b62',
  paper78: 'rgba(246,241,231,0.78)',
  paper70: 'rgba(246,241,231,0.70)',
  paper92: 'rgba(246,241,231,0.92)',
} as const;

export const WEB_FONTS = {
  serifCn: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
  sansCn: '"Noto Sans SC", "PingFang SC", "Heiti SC", sans-serif',
  serifEn: '"EB Garamond", "Times New Roman", Georgia, serif',
  sansEn: '"Inter", "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "Menlo", monospace',
} as const;

// 字体在导出时由 pdf-utils.tsx 的 registerPdfFonts 动态注册(POST /api/v1/fonts/subset
// 按本册实际用字现切的 Noto SC subset,见 #31)。
// 模板里 serif* / sans* 槽位承载动态文案,语言不固定(中/英都可能),而
// @react-pdf 没有逐字回退 —— 所以 serif/sans 一律指向覆盖拉丁+中文的 Noto SC,
// 任何槽位收到中文都不再回退成「口口」。Noto SC 自带高质量拉丁字形,英文版式不受损。
// mono 只用于 VOL/日期/「MEMOIR」等拉丁装饰标签,保留内置 Courier。
export const PDF_FONTS = {
  serifCn: 'NotoSerifSC',
  sansCn: 'NotoSansSC',
  serifEn: 'NotoSerifSC',
  sansEn: 'NotoSansSC',
  mono: 'Courier',
} as const;

// A4 @ 96dpi = 794 × 1123 px;PDF 也使用同样数字作 page size(pt),
// 比例与 Web 完全一致,打印时按比例缩放即可。
export const PAGE = {
  width: 794,
  height: 1123,
} as const;
