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

test("没有档案的照片走 fit 时退回默认，并在 notes 里说清楚", async () => {
	const { tools, getBook } = createHarness();
	const result = JSON.parse(
		// 内页 4 = 数组 3(双宽页吃掉了 2 和 3 两个号)。
		await run(tools, "set_image_pos", { updates: [{ pageNo: 4, positions: { image: { fit: "center-subject" } } }] }),
	);
	assert.deepEqual(getBook().pages[3]?.imagePos?.image, { x: 50, y: 50, scale: 1 });
	assert.ok(
		(result.notes ?? []).some((note: string) => note.includes("档案")),
		`notes 应说明没有档案：${JSON.stringify(result.notes)}`,
	);
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
