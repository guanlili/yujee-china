// @yujee/contracts/design 的类型 shim —— 仅供 tsgo 构建(tsconfig.build.json paths)。
// 运行时(dev 与 fly 生产,见 Dockerfile)都是 tsx 直跑源码,解析的是 contracts 真实
// TS 源;本文件只是让"本包可独立 tsgo 构建"的既有约定在引入配色簇后继续成立
// (与旁边 contracts-render.d.ts 同一约定 —— contracts 自己的 tsconfig 不是
// node16/nodenext,相对 import 不带扩展名在那边合法,但 design-agent 的 tsgo
// 构建要求显式扩展名,直接指向 contracts 源码会报 TS2835)。
// 若 contracts/design 的这几个签名变了,这里要同步(有 set-page-background 测试兜底)。

export type BookStyleId = "editorial" | "magazine" | "dopamine" | "postcard";

/** 内页配色条目(镜像 third-set-palette.ts 的 DarkInk)。 */
export interface DesignDarkInk {
	id: string;
	bg: string;
	accent: string;
	body: string;
}

export interface BookStyle {
	id: BookStyleId;
	name: string;
	nameEn: string;
	mood: string;
	coverTemplateId: string;
	endingTemplateId: string;
	pageBackground: string;
	colors: { title: string; body: string; explain: string };
	interiorInks?: readonly DesignDarkInk[];
}

export interface BackgroundOption {
	id: string;
	name: string;
	hex: string;
}

export declare function bookStyleOf(coverTemplateId: string | null | undefined): BookStyle;
export declare function bookStyleById(id: string | null | undefined): BookStyle | undefined;
export declare const BOOK_STYLES: readonly BookStyle[];
export declare function styleBackgroundOptions(styleId: string): BackgroundOption[];
export declare function bestInkFor(bg: string): string;
export declare function interiorInkSequence(seed: string, count: number): readonly DesignDarkInk[];
export declare const PAGE_BACKGROUND_CARRIER_KEY: "#pageBackground";
