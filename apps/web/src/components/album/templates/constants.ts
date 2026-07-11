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
  // ── 艺术字库（B1 定稿）：中文 9 + 英文补充。均带中文回退防豆腐。字体二进制未 vendor 前
  // 首选族缺失会优雅回退到 Noto/系统字，不崩；vendor + @font-face 后即忠实显示。 ──
  // 中文（noto-serif-sc/noto-sans-sc 复用 serifCn/sansCn）
  zcoolXiaowei: '"ZCOOL XiaoWei", "Noto Serif SC", "Songti SC", serif',
  lxgwWenkai: '"LXGW WenKai", "Noto Serif SC", "Songti SC", serif',
  smileySans: '"Smiley Sans", "Noto Sans SC", "PingFang SC", sans-serif',
  zcoolQingke: '"ZCOOL QingKe HuangYou", "Noto Sans SC", "PingFang SC", sans-serif',
  longCang: '"Long Cang", "Noto Serif SC", "Songti SC", serif',
  zhiMangXing: '"Zhi Mang Xing", "Noto Serif SC", "Songti SC", serif',
  liuJianMaoCao: '"Liu Jian Mao Cao", "Noto Serif SC", "Songti SC", serif',
  // 英文补充（inter/eb-garamond/jetbrains/lora/montserrat/poppins/raleway/abril/bebas/playfair 复用上面）
  sourceSerif: '"Source Serif 4", "Noto Serif SC", "Songti SC", serif',
  libreBaskerville: '"Libre Baskerville", "Noto Serif SC", "Songti SC", serif',
  dmSans: '"DM Sans", "Noto Sans SC", "PingFang SC", sans-serif',
  cormorant: '"Cormorant Garamond", "Noto Serif SC", "Songti SC", serif',
  archivoBlack: '"Archivo Black", "Noto Sans SC", "PingFang SC", sans-serif',
  ibmPlexMono: '"IBM Plex Mono", "Noto Sans SC", "Menlo", monospace',
  greatVibes: '"Great Vibes", "Noto Serif SC", "Songti SC", cursive',
  dancingScript: '"Dancing Script", "Noto Serif SC", "Songti SC", cursive',
  sacramento: '"Sacramento", "Noto Serif SC", "Songti SC", cursive',
  parisienne: '"Parisienne", "Noto Serif SC", "Songti SC", cursive',
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
  zcoolXiaowei: 'ZCOOL XiaoWei',
  lxgwWenkai: 'LXGW WenKai',
  smileySans: 'Smiley Sans',
  zcoolQingke: 'ZCOOL QingKe HuangYou',
  longCang: 'Long Cang',
  zhiMangXing: 'Zhi Mang Xing',
  liuJianMaoCao: 'Liu Jian Mao Cao',
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
  sourceSerif: 'Source Serif 4',
  libreBaskerville: 'Libre Baskerville',
  dmSans: 'DM Sans',
  cormorant: 'Cormorant Garamond',
  archivoBlack: 'Archivo Black',
  ibmPlexMono: 'IBM Plex Mono',
  jetbrainsMono: 'JetBrains Mono',
  greatVibes: 'Great Vibes',
  dancingScript: 'Dancing Script',
  sacramento: 'Sacramento',
  parisienne: 'Parisienne',
} as const;

// A4 @ 96dpi = 794 × 1123 px;PDF 也使用同样数字作 page size(pt),
// 比例与 Web 完全一致,打印时按比例缩放即可。
export const PAGE = {
  width: 794,
  height: 1123,
} as const;

// 展示级大标题自适应字号:按最长行的视觉宽度(CJK 记 1 全宽、其余记 0.62)把字号
// 缩到盒宽内,下限保住展示感。封面/封底这类超大字模板用;web 与 PDF 共用同一函数,
// 两端字号一致。maxChars 契约挡不住"字数合法但一行放不下"(如 96px 里的长英文标题)。
export function fitDisplayFontSize(
  text: string,
  boxWidth: number,
  maxSize: number,
  minSize = 44,
): number {
  const lines = (text || '').split('\n');
  const widest = Math.max(
    1,
    ...lines.map((line) =>
      [...line].reduce(
        (w, ch) => w + (/[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : 0.62),
        0,
      ),
    ),
  );
  return Math.max(minSize, Math.min(maxSize, Math.floor(boxWidth / widest)));
}
