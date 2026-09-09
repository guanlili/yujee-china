import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type AlbumBookState, cloneAlbumBookState, parseAlbumBookInput } from "../src/core/album/book-state.ts";
import { LUT_IDS, type PhotoFilterPatch } from "../src/core/album/photo-filter.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";
import { stripComments } from "./helpers/source-comments.ts";

/**
 * set_photo_filter / set_photo_cutout —— 整本定调与抠图。
 *
 * 两个工具走独立的 applyPhotoFilter seam(albums.photo_filter + settingsRevision),
 * **不走 commitWrite** —— 页面和设置是两套存储两套 OCC,混在一起必并发脏写。
 * seam 未注入时不注册:宁可没这个能力,也不能让模型调一个写不进去的工具。
 */

function bookInput(): Record<string, unknown> {
	return {
		version: 1,
		chapters: [
			{
				chapterId: "c1",
				photos: [
					{ photoId: "p1", sceneDescription: "照片一" },
					{ photoId: "p2", sceneDescription: "照片二" },
					{ photoId: "p3", sceneDescription: "照片三" },
				],
			},
		],
		pages: [
			{ pageIndex: 0, templateId: "mag-01", images: { image: "p1" }, texts: {} },
			{ pageIndex: 1, templateId: "mag-05", images: { image: "p2" }, texts: {} },
		],
	};
}

interface Harness {
	tools: Map<string, AgentTool>;
	calls: PhotoFilterPatch[];
	setBookStateCalls: number;
	getBook: () => AlbumBookState;
}

function createHarness(options?: { warnings?: string[]; withSeam?: boolean }): Harness {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(bookInput()).book;
	const calls: PhotoFilterPatch[] = [];
	const harness = { calls, setBookStateCalls: 0 } as Harness;
	const toolOptions: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			harness.setBookStateCalls += 1;
			book = cloneAlbumBookState(next);
		},
		...(options?.withSeam === false
			? {}
			: {
					applyPhotoFilter: async (patch: PhotoFilterPatch) => {
						calls.push(patch);
						return { warnings: options?.warnings ?? [] };
					},
				}),
	};
	harness.tools = new Map(createAlbumTools(toolOptions).map((tool) => [tool.name, tool as AgentTool]));
	harness.getBook = () => book;
	return harness;
}

async function run(tools: Map<string, AgentTool>, name: string, input: unknown): Promise<string> {
	const tool = tools.get(name);
	assert.ok(tool, `tool ${name} 不存在`);
	const params = tool.prepareArguments ? tool.prepareArguments(input) : input;
	const result = await tool.execute("test-call", params as never);
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

test("set_photo_filter 走 applyPhotoFilter seam，不走 commitWrite", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_filter", { default: { lutId: "travel-cinematic", strength: 60 } });
	assert.equal(harness.calls.length, 1);
	assert.deepEqual(harness.calls[0], { default: { lutId: "travel-cinematic", strength: 60 } });
	assert.equal(harness.setBookStateCalls, 0, "页面状态一动不动");
	assert.equal(harness.getBook().version, 1, "书 version 不该前进 —— 滤镜不是页面写入");
});

test("没注入 seam 时不注册这两个工具", () => {
	// 宁可没有这个能力，也不能让模型调一个写不进去的工具。
	const names = [...createHarness({ withSeam: false }).tools.keys()];
	assert.ok(!names.includes("set_photo_filter"));
	assert.ok(!names.includes("set_photo_cutout"));
	// 其它工具照常在。
	assert.ok(names.includes("read_page"));
});

test("注入 seam 后两个工具都注册", () => {
	const names = [...createHarness().tools.keys()];
	assert.ok(names.includes("set_photo_filter"));
	assert.ok(names.includes("set_photo_cutout"));
});

test("未知 lutId 被拒，错误里带可用清单", async () => {
	const harness = createHarness();
	await assert.rejects(
		() => run(harness.tools, "set_photo_filter", { default: { lutId: "vaporwave", strength: 50 } }),
		/cloudy-cool/,
	);
	// 模型编了个滤镜名时，要能自己改对，不能只说"错了"。
	assert.equal(harness.calls.length, 0, "非法请求不该穿到 seam");
});

test("strength 过 quantizeStrength 归到 5 的倍数", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_filter", { default: { lutId: "retro-film", strength: 63 } });
	assert.equal(harness.calls[0]?.default?.strength, 65);
});

test("strength 超出 0-100 被拒", async () => {
	const harness = createHarness();
	await assert.rejects(
		() => run(harness.tools, "set_photo_filter", { default: { lutId: "retro-film", strength: 140 } }),
		/strength/,
	);
});

test("default:null 表示整本回到原片", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_filter", { default: null });
	assert.deepEqual(harness.calls[0], { default: null });
});

test("overrides 支持单张指定与单张原片(null)", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_filter", {
		overrides: { p1: { lutId: "night-film", strength: 40 }, p2: null },
	});
	assert.deepEqual(harness.calls[0], {
		overrides: { p1: { lutId: "night-film", strength: 40 }, p2: null },
	});
});

test("overrides 里不属于本书的 photoId 被拒", async () => {
	const harness = createHarness();
	await assert.rejects(
		() => run(harness.tools, "set_photo_filter", { overrides: { nope: { lutId: "night-film", strength: 40 } } }),
		/nope/,
	);
	assert.equal(harness.calls.length, 0);
});

test("既没给 default 也没给 overrides 时报错，不空调 seam", async () => {
	const harness = createHarness();
	await assert.rejects(() => run(harness.tools, "set_photo_filter", {}), /default|overrides/);
	assert.equal(harness.calls.length, 0);
});

test("warnings 进工具结果的 notes，让 Agent 转告用户", async () => {
	const harness = createHarness({ warnings: ["这本书已分享，改滤镜会让分享快照失配"] });
	const result = JSON.parse(await run(harness.tools, "set_photo_filter", { default: null }));
	assert.ok(
		(result.notes ?? []).some((note: string) => note.includes("已分享")),
		JSON.stringify(result.notes),
	);
});

test("set_photo_cutout 关掉时传 null（删键），绝不传 false", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_cutout", { photoIds: ["p1"], on: false });
	// 契约铁律:cutouts 只认 true，关掉是删键。允许 false 会让「没抠」有两种表示。
	assert.equal(harness.calls[0]?.cutouts?.p1, null);
	assert.notEqual(harness.calls[0]?.cutouts?.p1, false);
	assert.ok(!JSON.stringify(harness.calls[0]).includes("false"), "整条 patch 里都不许出现 false");
});

test("set_photo_cutout 开启时传 true", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_cutout", { photoIds: ["p1"], on: true });
	assert.deepEqual(harness.calls[0], { cutouts: { p1: true } });
});

test("set_photo_cutout 一次可以处理多张", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_cutout", { photoIds: ["p1", "p2", "p3"], on: true });
	assert.deepEqual(harness.calls[0]?.cutouts, { p1: true, p2: true, p3: true });
	assert.equal(harness.calls.length, 1, "一次调用一次 seam，别逐张打");
});

test("set_photo_cutout 的 photoId 不属于本书时被拒", async () => {
	const harness = createHarness();
	await assert.rejects(() => run(harness.tools, "set_photo_cutout", { photoIds: ["ghost"], on: true }), /ghost/);
	assert.equal(harness.calls.length, 0);
});

test("set_photo_cutout 空清单被拒，不空调 seam", async () => {
	const harness = createHarness();
	await assert.rejects(() => run(harness.tools, "set_photo_cutout", { photoIds: [], on: true }), /photoIds/);
	assert.equal(harness.calls.length, 0);
});

test("set_photo_cutout 也不碰书状态", async () => {
	const harness = createHarness();
	await run(harness.tools, "set_photo_cutout", { photoIds: ["p1"], on: true });
	assert.equal(harness.setBookStateCalls, 0);
	assert.equal(harness.getBook().version, 1);
});

// ── on 的方向不能猜 ─────────────────────────────────────────────────────
// 旧写法 `on: args.on !== false` 把 "false"(字符串)、0、缺省全部折成 true:
// 用户说「把这张的抠图关掉」→ 模型吐 on:"false" → 照片反而被抠掉背景 →
// renderVersion 变化 → 已发布的分享快照失配。**反向执行比不执行糟得多**,
// 所以只有布尔 true 才开,非布尔一律报错(错误里带合法值让模型自己改对),绝不猜。

const NON_BOOLEAN_ON: Array<[string, unknown]> = [
	["字符串 false", "false"],
	["字符串 true", "true"],
	["数字 0", 0],
	["数字 1", 1],
	["null", null],
];

for (const [label, value] of NON_BOOLEAN_ON) {
	test(`set_photo_cutout 的 on 收到${label}时报错，不替模型猜方向`, async () => {
		const harness = createHarness();
		await assert.rejects(
			() => run(harness.tools, "set_photo_cutout", { photoIds: ["p1"], on: value }),
			/on 必须是布尔值/,
		);
		assert.equal(harness.calls.length, 0, "非布尔 on 不该穿到 seam —— 猜错方向就是反向执行");
	});
}

test("set_photo_cutout 缺 on 时报错 —— 缺省当成开，用户要关反而被抠", async () => {
	const harness = createHarness();
	await assert.rejects(() => run(harness.tools, "set_photo_cutout", { photoIds: ["p1"] }), /on 必须是布尔值/);
	assert.equal(harness.calls.length, 0);
});

test("set_photo_cutout 的 on 报错信息里带合法取值，模型能自己改对", async () => {
	const harness = createHarness();
	await assert.rejects(() => run(harness.tools, "set_photo_cutout", { photoIds: ["p1"], on: "false" }), (error: Error) => {
		assert.match(error.message, /true/);
		assert.match(error.message, /false/);
		return true;
	});
});

test("execute 兜底：非布尔 on 直落到 execute 时也只走关闭(删键)方向", async () => {
	// prepareArguments 已经拦在前面,这是第二道防线:方向的默认值必须是安全的那一侧。
	const harness = createHarness();
	const tool = harness.tools.get("set_photo_cutout");
	assert.ok(tool);
	await tool.execute("test-call", { photoIds: ["p1"], on: "false" } as never);
	assert.equal(harness.calls[0]?.cutouts?.p1, null, "只有布尔 true 才准开抠图");
});

test("抠图工具描述里写明不做整本默认全抠", () => {
	const description = createHarness().tools.get("set_photo_cutout")?.description ?? "";
	assert.match(description, /不要|别|逐张/);
});

test("调色工具描述教模型先读档案再选滤镜", () => {
	const description = createHarness().tools.get("set_photo_filter")?.description ?? "";
	assert.match(description, /档案|colorTemp|mood/);
});

test("seam 抛错时工具原样抛出，不吞", async () => {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(bookInput()).book;
	const tools = new Map(
		createAlbumTools({
			catalog,
			getBookState: () => cloneAlbumBookState(book),
			setBookState: (next) => {
				book = cloneAlbumBookState(next);
			},
			applyPhotoFilter: async () => {
				throw new Error("SETTINGS_CONFLICT");
			},
		}).map((tool) => [tool.name, tool as AgentTool]),
	);
	// OCC 冲突直接报错让 Agent 重试，不做自动合并(设计文档 §6②)。
	await assert.rejects(() => run(tools, "set_photo_filter", { default: null }), /SETTINGS_CONFLICT/);
});

// ── 与 apps/web 的 LUT 清单防漂移 ────────────────────────────────────────
// design-agent 是 packages/** 里的库,不能反向依赖 apps/web,所以 LUT id 清单是
// 抄的一份镜像。抄的东西一定会漂 —— 加一道机械守卫直接读真相源比对。

/**
 * 从真相源文本里读出 LUT id 清单(抽成函数才测得动:真相源不方便为了跑守卫去改)。
 * **先剥注释** —— 见 test/helpers/source-comments.ts 顶部那段为什么。
 */
function parseLutIds(source: string): Array<string | undefined> {
	const body = stripComments(source).split("export const LUT_DEFINITIONS = [")[1]?.split("] as const;")[0];
	assert.ok(body, "真相源结构变了 —— LUT_DEFINITIONS 数组没找到");
	return [...body.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((match) => match[1]);
}

test("清单解析先剥注释 —— 注释掉的 LUT 不该被数进来", () => {
	// 这道守卫存在的全部理由就是拦漂移;不剥注释的话,谁加一行注释掉的 LUT,
	// 26 这个数量闸和 deepEqual 就一起被喂饱,守卫从此永远绿。
	const faux = [
		"export const LUT_DEFINITIONS = [",
		"  { id: 'alpha', label: '甲' },",
		"  // { id: 'ghost-line', label: '被行注释掉的' },",
		"  /* { id: 'ghost-block' }, */",
		"  { id: 'beta', label: '乙' },",
		"] as const;",
	].join("\n");
	assert.deepEqual(parseLutIds(faux), ["alpha", "beta"]);
});

test("LUT_IDS 与 apps/web 的 LUT_DEFINITIONS 逐字一致", () => {
	const source = readFileSync(
		fileURLToPath(new URL("../../../apps/web/src/lib/photo/filter-state.ts", import.meta.url)),
		"utf8",
	);
	const webIds = parseLutIds(source);
	assert.equal(webIds.length, 26, `真相源里应有 26 个 LUT，读到 ${webIds.length} 个`);
	assert.deepEqual([...LUT_IDS], webIds, "滤镜清单漂移：apps/web 改了 LUT_DEFINITIONS，这边没跟上");
});
