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
  // 拉丁字体一律带中文回退（"Noto Serif/Sans SC" + 系统中文）：英文字符用拉丁字、中文字符自动落到中文字，
  // 一个字体中英文都不豁牙/不豆腐。@font-face 见 globals.css。
  serifEn: '"EB Garamond", "Noto Serif SC", "Songti SC", serif',
  sansEn: '"Inter", "Noto Sans SC", "PingFang SC", sans-serif',
  mono: '"JetBrains Mono", "Noto Sans SC", "Menlo", monospace',
  playfair: '"Playfair Display", "Noto Serif SC", "Songti SC", serif',
  lora: '"Lora", "Noto Serif SC", "Songti SC", serif',
  abril: '"Abril Fatface", "Noto Serif SC", "Songti SC", serif',
  montserrat: '"Montserrat", "Noto Sans SC", "PingFang SC", sans-serif',
  poppins: '"Poppins", "Noto Sans SC", "PingFang SC", sans-serif',
  worksans: '"Work Sans", "Noto Sans SC", "PingFang SC", sans-serif',
  raleway: '"Raleway", "Noto Sans SC", "PingFang SC", sans-serif',
  bebas: '"Bebas Neue", "Noto Sans SC", Impact, sans-serif',
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
  // 真拉丁字体（仅英文安全，无中文字形）——画布模板的英文槽用，和 web 一致；
  // 由 pdf-utils registerPdfFonts 从 /fonts/*.ttf 注册（与 web @font-face 同一份文件）。
  garamond: 'EB Garamond',
  interEn: 'Inter',
  playfair: 'Playfair Display',
  lora: 'Lora',
  abril: 'Abril Fatface',
  montserrat: 'Montserrat',
  poppins: 'Poppins',
  worksans: 'Work Sans',
  raleway: 'Raleway',
  bebas: 'Bebas Neue',
} as const;

// A4 @ 96dpi = 794 × 1123 px;PDF 也使用同样数字作 page size(pt),
// 比例与 Web 完全一致,打印时按比例缩放即可。
export const PAGE = {
  width: 794,
  height: 1123,
} as const;
