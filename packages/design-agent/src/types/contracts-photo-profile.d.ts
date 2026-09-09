// @yujee/contracts(根导出)的类型 shim —— 仅供 tsgo 构建(tsconfig.build.json paths)。
// 运行时(dev 与 fly 生产,见 Dockerfile)都是 tsx 直跑源码,解析的是 contracts 真实
// TS 源;本文件只是让"本包可独立 tsgo 构建"的既有约定在引入照片档案后继续成立
// (与旁边 contracts-render.d.ts / contracts-design.d.ts 同一约定 —— contracts 自己的
// tsconfig 不是 node16/nodenext,相对 import 不带扩展名在那边合法,但 design-agent 的
// tsgo 构建要求显式扩展名,直接指向 contracts 源码会报 TS2835)。
//
// 真相源:packages/contracts/src/photo-profile.ts。字段名漂移由
// test/album-contract-parity.test.ts 的机械守卫拦住。
//
// ⚠️ 坐标一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。别用 [0,1] ——
// 两套坐标系并存,模型心算必错(页码换算已经栽过一次)。
// ⚠️ 隐私红线:本 shim **不得**新增任何 location/place/GPS/lat/lng/coordinate 字段。

export interface PhotoBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface PhotoProfile {
	v: 1;
	subjectBox: PhotoBox | null;
	faceBoxes: PhotoBox[];
	maskKey: string | null;
	colorTemp: "warm" | "neutral" | "cool";
	brightness: "dark" | "mid" | "bright";
	saturation: "muted" | "normal" | "vivid";
	dominantColors: string[];
	/** 可空是刻意的:视觉调用失败时语义组落 null,不编造 focal。见契约同名字段的注释。 */
	composition: "closeup" | "focal" | "wide" | null;
	scene: "indoor" | "outdoor" | "nature" | "city" | "interior";
	peopleCount: "0" | "1" | "2-3" | "4+";
	mood: "warm" | "cool" | "sentimental" | "energetic" | "quiet";
	description: string;
}

/** 只声明本包实际用到的那一小片 zod 表面(safeParse),不复刻整个 ZodType。 */
export declare const PhotoProfileSchema: {
	safeParse(
		value: unknown,
	):
		| { success: true; data: PhotoProfile }
		| { success: false; error: { issues: Array<{ message: string }> } };
};

export declare const PHOTO_PROFILE_VERSION: 1;
