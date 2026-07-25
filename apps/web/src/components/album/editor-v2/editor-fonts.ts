/* ════════════════════════════════════════════════════════════════════════════
   editor-fonts —— 编辑器字体表。桌面树与移动树共用同一份。

   原本是 EditorPort.tsx 里的私有常量。移动端弹窗也要列字体,但从那个 4700 行的
   桌面组件 import 会把整棵桌面树打进移动端 bundle,所以原样抽到这里。
   共享的是数据,不是 UI —— 两边各自渲染自己的字体选择器。
   ════════════════════════════════════════════════════════════════════════════ */

import { isCjkFontId, type CjkFontId } from '@/services/font/font-manifest';
import { FONT_CATALOG } from '@yujee/contracts/render';

// ── 字体选择器数据源:项目字体目录(FONT_CATALOG = ArtFontPack,engine 与 web 同一套)
// 去掉抽象遗留载体后的**全部真实字体**。中文 9 + 英文若干,拉丁字体 @font-face 见
// styles/globals.css,中文走 /api/v1/fonts/subset 按需子集,均可真渲染。
// 不按 design_style.md 裁剪(该文档字体未定稿);列全,选中即写回 html 真相。 ──
export const EDITOR_FONT_NAMES: Record<string, string> = {
  'noto-serif-sc': '思源宋体', 'noto-sans-sc': '思源黑体', 'zcool-xiaowei': '站酷小薇',
  'lxgw-wenkai': '霞鹜文楷', 'smiley-sans': '得意黑', 'zcool-qingke-huangyou': '站酷庆科黄油',
  'long-cang': '龙藏', 'zhi-mang-xing': '志莽行书', 'liu-jian-mao-cao': '柳建毛草',
  'playfair-display': 'Playfair Display', 'cormorant-garamond': 'Cormorant Garamond',
  'eb-garamond': 'EB Garamond', 'source-serif-4': 'Source Serif 4', lora: 'Lora',
  'libre-baskerville': 'Libre Baskerville', 'abril-fatface': 'Abril Fatface',
  'bebas-neue': 'Bebas Neue', 'archivo-black': 'Archivo Black', montserrat: 'Montserrat',
  inter: 'Inter', 'work-sans': 'Work Sans', 'dm-sans': 'DM Sans', poppins: 'Poppins',
  raleway: 'Raleway', 'ibm-plex-mono': 'IBM Plex Mono', 'jetbrains-mono': 'JetBrains Mono',
  'great-vibes': 'Great Vibes', 'dancing-script': 'Dancing Script', sacramento: 'Sacramento',
  parisienne: 'Parisienne',
};
// 抽象载体不进选择器(它们只是映射到具体字体的历史别名)。
export const EDITOR_FONT_SKIP = new Set(['serif-classic', 'sans-modern', 'script-elegant', 'display-bold']);
export interface EditorFont { id: string; name: string; script: 'cjk' | 'latin'; stack: string; cjkId?: CjkFontId; }
export const EDITOR_FONTS: EditorFont[] = Object.entries(FONT_CATALOG)
  .filter(([id]) => !EDITOR_FONT_SKIP.has(id) && EDITOR_FONT_NAMES[id])
  .map(([id, entry]) => ({
    id,
    name: EDITOR_FONT_NAMES[id]!,
    script: entry.script,
    // entry.webFontFamily 已是具体 web 字体栈字符串(不是 WEB_FONTS 的 key)。
    stack: entry.webFontFamily,
    cjkId: isCjkFontId(id) ? id : undefined,
  }));
// 中文项预览串:字体名 + 一句短样例(子集化只拉这些字,极小)。
export const CJK_PREVIEW_SAMPLE = '字体预览一二三';
