import { renderPageHtml } from '@yujee/contracts/render';
import { applyImageRotatePatches } from '@/components/album/page-html-dom';
import { ERRORS } from '@/lib/api/error-codes';

// C 方案(页面真相 = HTML):排版合并 / 设计应用落库前,把每页烘成完整 HTML。
// - 文字/颜色/字体烘干进 html;
// - 图片 src 保持 `{{IMG_SRC:slotId}}` token(渲染时才解析成 blob/高清 URL;
//   photoId/base64 不进 html —— photo 引用的真相仍在 page.images);
// - 已带 html 的页跳过(编辑器 DOM patch / AI write_page_html 的成果不被覆盖);
// - 结构性操作(换排版/主题重刷)要重烘时,调用方先清掉 html 再进来。

export interface BakeablePage {
  pageIndex: number;
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
  imagePos?: Record<string, { x: number; y: number; scale: number; rotate?: number }> | null;
  html?: string;
  [key: string]: unknown;
}

const IMG_SRC_TOKEN: (slot: string) => string = (slot) => `{{IMG_SRC:${slot}}}`;

export interface BakeOptions {
  // strict(默认):templateId 没有 HTML 模板时抛错 —— M2 全量后生成链路该用的模式。
  // lenient(strict: false):跳过该页(html 留空,渲染端回退 React 模板)——
  // 迁移过渡期专用,registry 补齐后移除调用方的 lenient。
  strict?: boolean;
}

export function bakePageHtml(page: BakeablePage, options: BakeOptions = {}): BakeablePage {
  if (typeof page.html === 'string' && page.html.length > 0) return page;
  const html = renderPageHtml(
    {
      templateId: page.templateId,
      images: page.images,
      texts: page.texts,
      imagePos: page.imagePos ?? undefined,
    },
    // resolveImage 收到 photoId,但落库形态必须是 token:按 images 反查槽位。
    (photoId) => {
      const slot = Object.entries(page.images).find(([, pid]) => pid === photoId)?.[0];
      return slot ? IMG_SRC_TOKEN(slot) : '';
    },
  );
  if (!html) {
    if (options.strict === false) return page;
    throw ERRORS.VALIDATION_FAILED(`模板 ${page.templateId} 没有注册 HTML 模板,无法烘制页面`);
  }
  // fill-template 的 IMG_TF 是纯 token 替换,够不到 wrapper 几何,rotate 只能烘完再
  // 用 patchHtmlImagePos 补盒交换 —— 否则整页重烘(如 imagePos patch 失配的兜底)
  // 会静默丢掉用户已保存的旋转。
  return { ...page, html: applyImageRotatePatches(html, page.imagePos ?? undefined) };
}

export function bakePagesHtml(pages: BakeablePage[], options: BakeOptions = {}): BakeablePage[] {
  return pages.map((page) => bakePageHtml(page, options));
}
