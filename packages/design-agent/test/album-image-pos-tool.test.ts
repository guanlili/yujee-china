import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PhotoProfile } from "@yujee/contracts";
import { type AlbumBookState, cloneAlbumBookState, parseAlbumBookInput } from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { IMAGE_FIT_MODES } from "../src/core/album/image-fit.ts";
import { createAlbumTools } from "../src/core/album/tools.ts";

/**
 * set_image_pos —— 构图裁切。**几何归代码,模型只表达意图**:
 * fit 意图(center-subject / avoid-face-crop / fill)由 resolveImagePos 拿档案算,
 * 手动 x/y/scale 只在用户明确说方向时才用。
 */

const profile: PhotoProfile = {
	v: 1,
	subjectBox: { x: 10, y: 20, w: 40, h: 40 }, // 中心 30 / 40
	faceBoxes: [{ x: 60, y: 10, w: 20, h: 20 }], // 中心 70 / 20
	maskKey: null,
	colorTemp: "warm",
	brightness: "mid",
	saturation: "normal",
	dominantColors: [],
	composition: "focal",
	scene: "outdoor",
	peopleCount: "1",
	mood: "warm",
	description: "一个人站在礁石上",
};

/** 一本 4 页的书:封面 + 单图内页(带档案) + 双宽内页(占两个号) + 单图内页(无档案)。 */
function bookInput(): Record<string, unknown> {
	return {
		version: 1,
		chapters: [
			{
				chapterId: "c1",
				photos: [
					{ photoId: "p1", sceneDescription: "带档案的照片", profile },
					{ photoId: "p2", sceneDescription: "双宽页的照片" },
					{ photoId: "p3", sceneDescription: "没建过档的老照片" },
					{ photoId: "p4", sceneDescription: "封面照片" },
				],
			},
		],
		pages: [
			{ pageIndex: 0, templateId: "mag-01", images: { image: "p4" }, texts: {} },
			{ pageIndex: 1, templateId: "mag-05", images: { image: "p1" }, texts: { title: "标题" } },
			{ pageIndex: 2, templateId: "mag-54", images: { image1: "p2" }, texts: {} },
			{ pageIndex: 3, templateId: "mag-05", images: { image: "p3" }, texts: {} },
		],
	};
}

function createHarness(overrides?: (raw: Record<string, unknown>) => void): {
	tools: Map<string, AgentTool>;
	getBook: () => AlbumBookState;
} {
	const raw = bookInput();
	overrides?.(raw);
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(raw).book;
	const tools = new Map(
		createAlbumTools({
			catalog,
			getBookState: () => cloneAlbumBookState(book),
			setBookState: (next) => {
				book = cloneAlbumBookState(next);
			},
		}).map((tool) => [tool.name, tool as AgentTool]),
	);
	return { tools, getBook: () => book };
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

test("set_image_pos 已注册，且 schema 不收 rotate", () => {
	const { tools } = createHarness();
	const tool = tools.get("set_image_pos");
	assert.ok(tool);
	// rotate 本批明确不动:schema 不收它,也不改任何现有 rotate 行为。
	assert.ok(!JSON.stringify(tool.parameters).includes("rotate"));
});

test("fit=center-subject 被工具解析成主体中心坐标", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "center-subject" } } }] });
	assert.deepEqual(getBook().pages[1]?.imagePos?.image, { x: 30, y: 40, scale: 1 });
});

test("fit=avoid-face-crop 用人脸并集中心", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "avoid-face-crop" } } }] });
	assert.deepEqual(getBook().pages[1]?.imagePos?.image, { x: 70, y: 20, scale: 1 });
});

test("fit=fill 回到 50/50/1", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "fill" } } }] });
	assert.deepEqual(getBook().pages[1]?.imagePos?.image, { x: 50, y: 50, scale: 1 });
});

// 没档案就算不出主体中心。以前的做法是退回 50/50/1 + 在 notes 里说一句 ——
// 但写工具是 terminate 的,模型这一轮**看不到**工具结果,只会照着调用前那句
// 「已按主体重新构图」交差,用户拿到的却是被推平的构图。所以这里必须报错:
// 报错是这一轮唯一能到达模型的通道,它才有机会说实话或改用坐标。
test("照片没有档案时 fit 意图报错，一个字节都不写", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(
		// 内页 4 = 数组 3(双宽页吃掉了 2 和 3 两个号)。
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 4, positions: { image: { fit: "center-subject" } } }] }),
		/档案/,
	);
	assert.equal(getBook().pages[3]?.imagePos ?? null, null, "算不出来就别写 —— 静默推平成 50/50/1 是反向执行");
	assert.equal(getBook().version, 1, "报错不该前进 book version");
});

test("没有档案也能用 fit=fill —— 铺满不需要几何", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: 4, positions: { image: { fit: "fill" } } }] });
	assert.deepEqual(getBook().pages[3]?.imagePos?.image, { x: 50, y: 50, scale: 1 });
});

test("有档案但 subjectBox 为 null(纯风景)时按契约走默认，不报错", async () => {
	// 契约写明 subjectBox=null 就是「没跑出主体,走默认 50/50/1」—— 这是**已知**事实,
	// 跟「没建过档」的未知不是一回事,不能混为一谈。
	const { tools, getBook } = createHarness((raw) => {
		const photos = (raw.chapters as Array<Record<string, unknown>>)[0]!.photos as Array<Record<string, unknown>>;
		photos[0]!.profile = { ...profile, subjectBox: null, faceBoxes: [] };
	});
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "center-subject" } } }] });
	assert.deepEqual(getBook().pages[1]?.imagePos?.image, { x: 50, y: 50, scale: 1 });
});

test("手动模式直接写 x/y/scale", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: 20, y: 80, scale: 1.4 } } }] });
	assert.deepEqual(getBook().pages[1]?.imagePos?.image, { x: 20, y: 80, scale: 1.4 });
});

test("html 同步 patch —— 只改数据不改 html，画板上照片纹丝不动", async () => {
	const { tools, getBook } = createHarness((raw) => {
		(raw.pages as Array<Record<string, unknown>>)[1]!.html =
			'<div data-template="mag-05"><div data-text-key="title">标题</div>' +
			'<img data-image-slot="image" src="{{IMG_SRC:image}}" style="object-fit:cover;object-position:50% 50%;" /></div>';
	});
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "center-subject" } } }] });
	const html = getBook().pages[1]?.html ?? "";
	assert.match(html, /object-position:\s*30% 40%/);
	assert.match(html, /data-text-key="title"/, "手工版面的其余部分不能被重烘冲掉");
});

test("双宽页用右半页的号也能命中同一张面", async () => {
	// 内页 1 = 数组 1;双宽页(mag-54)吃 2 和 3;数组 3 是内页 4。
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: 3, positions: { image1: { fit: "fill" } } }] });
	assert.deepEqual(getBook().pages[2]?.imagePos?.image1, { x: 50, y: 50, scale: 1 });
	assert.equal(getBook().pages[3]?.imagePos ?? null, null, "漏传 isSpread 会把号算少，写错页");
});

test("封面用 cover 寻址", async () => {
	const { tools, getBook } = createHarness();
	await run(tools, "set_image_pos", { updates: [{ pageNo: "cover", positions: { image: { fit: "fill" } } }] });
	assert.deepEqual(getBook().pages[0]?.imagePos?.image, { x: 50, y: 50, scale: 1 });
});

test("槽 id 不属于该模板时整批拒绝，不改状态", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(
		() =>
			run(tools, "set_image_pos", {
				updates: [
					{ pageNo: 1, positions: { image: { fit: "fill" } } },
					{ pageNo: 4, positions: { nope: { fit: "fill" } } },
				],
			}),
		/nope/,
	);
	assert.equal(getBook().pages[1]?.imagePos ?? null, null, "整批拒绝就不该有半截写入");
});

test("scale < 1 被拒 —— cover 语义下会露底", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: 50, y: 50, scale: 0.8 } } }] }),
		/scale/,
	);
	assert.equal(getBook().pages[1]?.imagePos ?? null, null);
});

test("scale > 2 被拒 —— 与 contracts 的 ImagePos 上限一致", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: 50, y: 50, scale: 3 } } }] }),
		/scale/,
	);
});

test("x/y 超出 0-100 被拒", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: 120, y: 50, scale: 1 } } }] }),
		/0-100|x/,
	);
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: 50, y: -3, scale: 1 } } }] }),
		/0-100|y/,
	);
});

test("旋转过的槽被拒 —— rotate 本批明确不动", async () => {
	const { tools, getBook } = createHarness((raw) => {
		(raw.pages as Array<Record<string, unknown>>)[1]!.imagePos = { image: { x: 50, y: 50, scale: 1, rotate: 90 } };
	});
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "center-subject" } } }] }),
		/旋转/,
	);
	assert.deepEqual(getBook().pages[1]?.imagePos?.image, { x: 50, y: 50, scale: 1, rotate: 90 });
});

test("写入不碰 texts 和 templateId", async () => {
	const { tools, getBook } = createHarness();
	const before = cloneAlbumBookState(getBook());
	await run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "center-subject" } } }] });
	const after = getBook();
	assert.deepEqual(after.pages[1]?.texts, before.pages[1]?.texts);
	assert.equal(after.pages[1]?.templateId, before.pages[1]?.templateId);
	assert.deepEqual(after.pages[1]?.images, before.pages[1]?.images);
});

test("只改列出的槽，同页其它槽的 imagePos 不动", async () => {
	const { tools, getBook } = createHarness((raw) => {
		const pages = raw.pages as Array<Record<string, unknown>>;
		pages[2]!.templateId = "mag-58";
		pages[2]!.images = { image1: "p2", image2: "p3" };
		pages[2]!.imagePos = { image2: { x: 10, y: 90, scale: 1.3 } };
	});
	await run(tools, "set_image_pos", { updates: [{ pageNo: 2, positions: { image1: { fit: "fill" } } }] });
	assert.deepEqual(getBook().pages[2]?.imagePos?.image2, { x: 10, y: 90, scale: 1.3 });
});

test("整本 imagePos 写完，书 version 前进一次", async () => {
	const { tools, getBook } = createHarness();
	const before = getBook().version;
	await run(tools, "set_image_pos", {
		updates: [
			{ pageNo: 1, positions: { image: { fit: "center-subject" } } },
			{ pageNo: 4, positions: { image: { fit: "fill" } } },
		],
	});
	assert.equal(getBook().version, before + 1);
});

test("工具描述教模型优先用 fit 意图，别自己心算坐标", () => {
	const { tools } = createHarness();
	const description = tools.get("set_image_pos")?.description ?? "";
	assert.match(description, /fit/);
	assert.match(description, /center-subject/);
});

test("schema 里的 fit 枚举与 IMAGE_FIT_MODES 一致 —— 手写字面量会漂", () => {
	const { tools } = createHarness();
	const schema = JSON.parse(JSON.stringify(tools.get("set_image_pos")?.parameters ?? {}));
	const variants = schema.properties.updates.items.properties.positions.patternProperties["^.*$"].anyOf;
	const fitVariant = variants.find((variant: { properties?: { fit?: unknown } }) => variant.properties?.fit);
	const literals = fitVariant.properties.fit.anyOf.map((entry: { const: string }) => entry.const);
	assert.deepEqual(literals, [...IMAGE_FIT_MODES]);
});

// ── 非法入参必须报错,不许静默降级 ─────────────────────────────────────
// 旧写法:isImageFit 不成立就掉进手工坐标分支、缺项补 50/50/1。
// 用户说「把这几页的人像居中」→ 模型写 fit:"center"(少了 -subject)→ N 页构图被
// 推平成 50/50/1、book version 前进、回执报成功 —— 用户以为「已按主体重新构图」。
//
// prepareArguments 之后其实**有**一道 typebox 兜底(pi-ai 的 validateToolArguments),
// 但它看到的是 prepareArguments 改写之后的入参:非法值已经被折成合法形状,防线形同虚设。
// 所以判非法这件事必须发生在 prepareArguments 自己身上。

test("fit 拼错时报错，错误里列出全部合法值", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "center" } } }] }),
		(error: Error) => {
			for (const mode of IMAGE_FIT_MODES) assert.match(error.message, new RegExp(mode));
			return true;
		},
	);
});

test("fit 拼错时一页都不写，book version 不前进", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(() =>
		run(tools, "set_image_pos", {
			updates: [
				{ pageNo: 1, positions: { image: { fit: "center-subject" } } },
				{ pageNo: 2, positions: { image1: { fit: "center" } } },
			],
		}),
	);
	assert.equal(getBook().pages[1]?.imagePos ?? null, null, "整批拒绝,不能有半截写入");
	assert.equal(getBook().version, 1);
});

test("x/y/scale 传字符串时报错，不静默补 50/50/1", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: "20", y: "80", scale: "1.4" } } }] }),
		/x/,
	);
	assert.equal(getBook().pages[1]?.imagePos ?? null, null);
});

test("坐标缺项时报错 —— 补默认等于把没提到的那一维推平", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { x: 20 } } }] }),
		/y|scale/,
	);
	assert.equal(getBook().pages[1]?.imagePos ?? null, null);
});

test("既没 fit 也没坐标时报错", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: {} } }] }),
		/fit/,
	);
});

test("同时给 fit 和坐标时报错 —— 二选一，不替模型挑", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: { fit: "fill", x: 20, y: 30, scale: 1 } } }] }),
		/fit/,
	);
});

test("positions 的条目不是对象时报错，不静默丢弃", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(
		() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: { image: "center-subject" } }] }),
		/image/,
	);
	assert.equal(getBook().version, 1);
});

// ── 空 positions 不许推进 book version(协同 OCC 下白给别人制造冲突面)────

test("positions 是空对象时报错，book version 不前进", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(() => run(tools, "set_image_pos", { updates: [{ pageNo: 1, positions: {} }] }), /positions/);
	assert.equal(getBook().version, 1, "没有实际改动就不该 commit —— 整书 replaceAll 会给协作者制造冲突");
});

test("execute 兜底：空 positions 直落到 execute 也不 commit", async () => {
	const { tools, getBook } = createHarness();
	const tool = tools.get("set_image_pos");
	assert.ok(tool);
	await assert.rejects(() => tool.execute("test-call", { updates: [{ pageNo: 1, positions: {} }] } as never), /positions/);
	assert.equal(getBook().version, 1);
});

test("整批里有一页 positions 为空就整批拒绝", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(() =>
		run(tools, "set_image_pos", {
			updates: [
				{ pageNo: 1, positions: { image: { fit: "fill" } } },
				{ pageNo: 4, positions: {} },
			],
		}),
	);
	assert.equal(getBook().version, 1);
});

test("缺 positions 的单页调用报错，不当成空写入", async () => {
	const { tools, getBook } = createHarness();
	await assert.rejects(() => run(tools, "set_image_pos", { pageNo: 1 }), /positions/);
	assert.equal(getBook().version, 1);
});
