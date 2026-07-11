// 页面 HTML 烘制(design-agent 侧,与 web 的 bake-html 同约定):
// 从模板重新生成页面 HTML —— 结构性操作(换排版/主题重刷)与缺 html 的
// 存量页兜底用。图片 src 一律保持 {{IMG_SRC:slotId}} token。
import { renderPageHtml } from "@yujee/contracts/render";
import type { AlbumPage } from "./book-state.ts";

export function bakeAlbumPageHtml(page: AlbumPage): string | undefined {
	return renderPageHtml(
		{
			templateId: page.templateId,
			images: page.images,
			texts: page.texts,
			imagePos: page.imagePos ?? undefined,
		},
		(photoId) => {
			const slot = Object.entries(page.images).find(([, pid]) => pid === photoId)?.[0];
			return slot ? `{{IMG_SRC:${slot}}}` : "";
		},
	);
}

/** 读页面 HTML:已有 html 用之,否则现场烘(存量数据兜底);模板未注册返回 undefined。 */
export function ensureAlbumPageHtml(page: AlbumPage): string | undefined {
	if (typeof page.html === "string" && page.html.length > 0) return page.html;
	return bakeAlbumPageHtml(page);
}
