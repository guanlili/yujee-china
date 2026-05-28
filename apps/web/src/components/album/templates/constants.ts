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

// @react-pdf/renderer 内置字体: Helvetica / Times-Roman / Courier
// 中文需要后续注册字体文件;一期 PDF 字体回退到拉丁字体,版式不变。
export const PDF_FONTS = {
  serifCn: 'Times-Roman',
  sansCn: 'Helvetica',
  serifEn: 'Times-Roman',
  sansEn: 'Helvetica',
  mono: 'Courier',
} as const;

// A4 @ 96dpi = 794 × 1123 px;PDF 也使用同样数字作 page size(pt),
// 比例与 Web 完全一致,打印时按比例缩放即可。
export const PAGE = {
  width: 794,
  height: 1123,
} as const;
