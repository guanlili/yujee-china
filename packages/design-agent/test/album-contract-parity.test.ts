import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PHOTO_PROFILE_VERSION, Page, PhotoProfileSchema, V3LayoutTree } from "@yujee/contracts";
import { cloneAlbumBookState, parseAlbumBookInput } from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";
import { stripComments } from "./helpers/source-comments.ts";

/**
 * 契约 parity：书状态的 pages 必须始终能通过 packages/contracts 的 zod Page
 * strict 契约（单一真相源）。工具写入前后都要保持逐页合法。
 */

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function loadBook() {
	return parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
}

function assertPagesContractLegal(pages: unknown[]): void {
	for (const page of pages) {
		const result = Page.safeParse(page);
		assert.ok(
			result.success,
			`page 不符合 contracts Page 契约：${result.success ? "" : JSON.stringify(result.error.issues)}\n${JSON.stringify(page)}`,
		);
	}
}

test("fixture 书的每一页都通过 contracts Page strict 契约", () => {
	assertPagesContractLegal(loadBook().pages);
});

test("fixture 书的章节树通过 contracts V3LayoutTree 契约（补默认字段后）", () => {
	const book = loadBook();
	// 书状态章节字段是 V3Chapter 的子集；补齐 strict 契约要求的占位字段做 parity 验证。
	const tree = {
		chapters: book.chapters.map((chapter) => ({
			chapterId: chapter.chapterId,
			description: chapter.description ?? "",
			chapterContext: chapter.chapterContext ?? "",
			accentColor: chapter.accentColor ?? null,
			artFont: chapter.artFont ?? null,
			photos: chapter.photos.map((photo) => ({
				photoId: photo.photoId,
				sceneDescription: photo.sceneDescription,
				width: photo.width ?? 1600,
				height: photo.height ?? 1200,
				orientation: (photo.orientation ?? "landscape") as "portrait" | "landscape" | "square",
				composition: (photo.composition ?? null) as "closeup" | "focal" | "wide" | null,
				takenAt: photo.takenAt ?? null,
			})),
		})),
	};
	const result = V3LayoutTree.safeParse(tree);
	assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues));
});

test("工具写入之后所有页仍然契约合法", async () => {
	const catalog = loadTemplateCatalog();
	let book = loadBook();
	const options: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
	};
	const tools = new Map(createAlbumTools(options).map((tool) => [tool.name, tool]));

	const updateTexts = tools.get("update_page_texts");
	const swapTemplate = tools.get("swap_page_template");
	const updateImages = tools.get("update_page_images");
	const deletePage = tools.get("delete_page");
	assert.ok(updateTexts && swapTemplate && updateImages && deletePage);

	await updateTexts.execute("t1", {
		updates: [
			{
				pageNo: 1,
				texts: { title: "我们仨的夏天", label: "SUMMER · 2019", body: "青岛的海风，和第一次看海的爸妈" },
			},
		],
	} as never);
	await swapTemplate.execute("t2", { pageNo: 4, templateId: "mag-30" } as never);
	await updateImages.execute("t3", {
		updates: [
			{
				pageNo: 3,
				images: { "image[0]": "p-sea-05", "image[1]": "p-sea-04", "image[2]": "p-sea-02", "image[3]": "p-sea-03" },
			},
		],
	} as never);

	await deletePage.execute("t4", deletePage.prepareArguments({ pageNo: 2 }) as never);

	assert.equal(book.version, 5);
	assertPagesContractLegal(book.pages);
});

// ── PhotoProfile 的类型 shim 防漂移 ─────────────────────────────────────
// 本包能独立 tsgo 构建的既有约定:`@yujee/contracts` 在 tsconfig.build.json 里
// 映射到 src/types/*.d.ts 的手写 shim(contracts 自己的 tsconfig 不是 node16,
// 相对 import 不带扩展名在那边合法,直指源码会让本包 TS2835)。手写 shim 会漂,
// 所以加一道机械守卫:字段名必须与契约真相源逐一对应。

// 源码正则守卫一律**先剥注释**再断言 —— 注释里写一行 `x: number` 也会被数进字段表。
function contractBody(): string {
	const contractPath = fileURLToPath(new URL("../../contracts/src/photo-profile.ts", import.meta.url));
	const body = stripComments(readFileSync(contractPath, "utf8"))
		.split("export const PhotoProfileSchema = z.object({")[1]
		?.split("}).strict();")[0];
	assert.ok(body, "契约文件结构变了 —— PhotoProfileSchema 的对象体没找到(或 .strict() 被摘了)");
	return body;
}

function shimBody(): string {
	const shimPath = fileURLToPath(new URL("../src/types/contracts-photo-profile.d.ts", import.meta.url));
	const body = stripComments(readFileSync(shimPath, "utf8")).split("export interface PhotoProfile {")[1]?.split("\n}")[0];
	assert.ok(body, "shim 里没有 PhotoProfile 接口");
	return body;
}

test("PhotoProfile 的本地类型 shim 与 contracts 真相源字段一致", () => {
	const contractFields = new Set([...contractBody().matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]));
	const shimFields = new Set([...shimBody().matchAll(/^\t(\w+)[?]?:/gm)].map((match) => match[1]));
	assert.deepEqual(
		[...shimFields].sort(),
		[...contractFields].sort(),
		"契约漂移：design-agent 的 PhotoProfile shim 与 packages/contracts 的字段对不上",
	);
});

// ── 光钉字段名不够:类型和取值也要钉 ─────────────────────────────────────
// 评审变异结果:加字段/改名会红,但把 Box 的 .min(0).max(100) 改成 .max(1) 是**绿**,
// 枚举加一个值也是绿。而「坐标一律 0-100 百分比」是 Global Constraints 里的硬约束
// (与 imagePos 的 objectPosition 同口径,两套坐标系并存 Agent 心算必错),枚举取值则是
// shim 里那几个联合类型的真相源。所以下面直接拿真 schema 的行为和取值来钉。

const VALID_PROFILE = {
	v: PHOTO_PROFILE_VERSION,
	subjectBox: { x: 20, y: 10, w: 55, h: 70 },
	faceBoxes: [{ x: 30, y: 15, w: 20, h: 25 }],
	maskKey: null,
	colorTemp: "warm",
	brightness: "mid",
	saturation: "normal",
	dominantColors: ["#C8A05A"],
	composition: "focal",
	scene: "outdoor",
	peopleCount: "1",
	mood: "warm",
	description: "傍晚的海边",
};

function accepts(patch: Record<string, unknown>): boolean {
	return PhotoProfileSchema.safeParse({ ...VALID_PROFILE, ...patch }).success;
}

test("坐标是 0-100 口径:边界收，越界拒（[0,1] 口径会当场红）", () => {
	assert.ok(accepts({}), "基准档案本身必须合法");
	for (const axis of ["x", "y", "w", "h"]) {
		assert.ok(
			accepts({ subjectBox: { x: 0, y: 0, w: 0, h: 0, [axis]: 100 } }),
			`subjectBox.${axis} = 100 必须收 —— 上限被改小(比如 .max(1))就是把坐标口径悄悄换成 [0,1]`,
		);
		assert.ok(!accepts({ subjectBox: { x: 50, y: 50, w: 50, h: 50, [axis]: 101 } }), `subjectBox.${axis} = 101 必须拒`);
		assert.ok(!accepts({ subjectBox: { x: 50, y: 50, w: 50, h: 50, [axis]: -1 } }), `subjectBox.${axis} = -1 必须拒`);
	}
});

test("faceBoxes 与 subjectBox 同一个 0-100 口径", () => {
	assert.ok(accepts({ faceBoxes: [{ x: 0, y: 0, w: 100, h: 100 }] }));
	assert.ok(!accepts({ faceBoxes: [{ x: 0, y: 0, w: 100, h: 101 }] }));
});

type ZodNode = { options?: unknown; _def?: { innerType?: ZodNode; typeName?: string } };

/** 剥掉 .nullable()/.default()/.optional() 的包装,拿到里面那个 z.enum。 */
function unwrap(node: ZodNode | undefined): ZodNode | undefined {
	let cur = node;
	for (let i = 0; cur && !Array.isArray(cur.options) && cur._def?.innerType && i < 8; i++) {
		cur = cur._def.innerType;
	}
	return cur;
}

function fieldNode(field: string): ZodNode | undefined {
	const shape = (PhotoProfileSchema as unknown as { shape?: Record<string, ZodNode> }).shape;
	return shape?.[field];
}

/** 真 schema 里某个 z.enum 的取值。结构变了就直接红,不静默放行。 */
function contractEnum(field: string): string[] {
	const options = unwrap(fieldNode(field))?.options;
	assert.ok(Array.isArray(options), `${field} 不再是 z.enum —— 契约结构变了,这道守卫必须跟着改`);
	return [...(options as string[])];
}

/** 契约里这个字段收不收 null。**取值列表比不出可空性** —— shimEnum 只抓带引号的
 * 字面量,`| null` 它看不见,于是「一侧可空一侧不可空」能从取值对齐里溜过去。
 * 2026-09-09 真栽过:Python 侧 composition 改可空、TS 侧没跟,语义降级的照片
 * 在 web 的逐条 safeParse 里被整条拒绝,连色彩/几何一起丢。 */
function contractNullable(field: string): boolean {
	return fieldNode(field)?.safeParse === undefined
		? (PhotoProfileSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>)[field]!.safeParse(null).success
		: (fieldNode(field) as unknown as { safeParse(v: unknown): { success: boolean } }).safeParse(null).success;
}

/** shim 里同一字段的联合类型收不收 null。 */
function shimNullable(field: string): boolean {
	const line = new RegExp(`^\\t${field}: ([^;]+);`, "m").exec(shimBody());
	assert.ok(line?.[1], `shim 里没有 ${field} 这一行`);
	return /\bnull\b/.test(line[1]);
}

/** shim 里同一字段的联合字面量。 */
function shimEnum(field: string): string[] {
	const line = new RegExp(`^\\t${field}: ([^;]+);`, "m").exec(shimBody());
	assert.ok(line?.[1], `shim 里没有 ${field} 这一行`);
	return [...line[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

for (const field of ["colorTemp", "brightness", "saturation", "composition", "scene", "peopleCount", "mood"]) {
	test(`枚举 ${field} 的可空性与本地 shim 一致（一侧改可空另一侧没跟就红）`, () => {
		assert.equal(
			shimNullable(field),
			contractNullable(field),
			`${field} 的可空性漂移:契约${contractNullable(field) ? "收" : "不收"} null,shim ${shimNullable(field) ? "收" : "不收"}`,
		);
	});

	test(`枚举 ${field} 的取值与本地 shim 逐一对齐（加值/改值都会红）`, () => {
		const contractValues = contractEnum(field);
		assert.ok(contractValues.length > 0);
		assert.deepEqual(shimEnum(field), contractValues, `${field} 的取值漂移:契约与 design-agent 的 shim 对不上`);
		for (const value of contractValues) assert.ok(accepts({ [field]: value }), `${field}=${value} 应该被接受`);
		assert.ok(!accepts({ [field]: "__not_a_real_value__" }), `${field} 必须是闭集 —— 换成 z.string() 这里就该红`);
	});
}

test("v 必须钉死在 PHOTO_PROFILE_VERSION", () => {
	assert.ok(!accepts({ v: PHOTO_PROFILE_VERSION + 1 }));
});

test("schema 是 strict 的 —— 多一个 key 就拒（隐私红线的执行机制）", () => {
	for (const key of ["location", "gps", "lat", "lng", "coordinates"]) {
		assert.ok(!accepts({ [key]: "anything" }), `${key} 必须在 parse 期被拒 —— 隐私红线靠 .strict() 执行`);
	}
});

test("dominantColors 最多 3 个、必须 6 位 hex", () => {
	assert.ok(accepts({ dominantColors: ["#112233", "#445566", "#778899"] }));
	assert.ok(!accepts({ dominantColors: ["#112233", "#445566", "#778899", "#AABBCC"] }));
	assert.ok(!accepts({ dominantColors: ["#FFF"] }));
});

test("description 上限 300 字", () => {
	assert.ok(accepts({ description: "字".repeat(300) }));
	assert.ok(!accepts({ description: "字".repeat(301) }));
});
