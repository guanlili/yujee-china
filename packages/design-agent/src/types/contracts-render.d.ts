// @yujee/contracts/render 的类型 shim —— 仅供 tsgo 构建(tsconfig.build.json paths)。
// 运行时(dev 与 fly 生产,见 Dockerfile)都是 tsx 直跑源码,解析的是 contracts 真实
// TS 源;本文件只是让"本包可独立 tsgo 构建"的既有约定在引入渲染簇后继续成立。
// 若 contracts/render 的这几个签名变了,这里要同步(有 album-html-guard/tools 测试兜底)。

export interface FillablePage {
	templateId: string;
	images: Record<string, string>;
	texts: Record<string, string>;
	imagePos?: Record<string, { x: number; y: number; scale: number }>;
}

export type ResolveImage = (photoId: string) => string | undefined;

export declare function fillTemplateHtml(
	templateHtml: string,
	page: FillablePage,
	resolveImage: ResolveImage,
): string;
export declare function renderPageHtml(page: FillablePage, resolveImage: ResolveImage): string | undefined;
export declare function getHtmlTemplate(id: string): string | undefined;
export declare function hasHtmlTemplate(id: string): boolean;
export declare const HTML_TEMPLATE_IDS: string[];
