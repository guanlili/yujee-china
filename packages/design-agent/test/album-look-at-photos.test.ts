import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PhotoProfile } from "@yujee/contracts";
import { cloneAlbumBookState, parseAlbumBookInput } from "../src/core/album/book-state.ts";
import { loadAlbumSkills } from "../src/core/album/skills-loader.ts";
import { createDefaultAlbumSkills } from "../src/core/album/skills.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

/**
 * look_at_photos —— 真图直喂的**兜底**通道,不是默认输入。
 * 常规视觉输入是 read_page 带回来的照片档案;只有档案答不了(「这张不对劲」)才看图。
 */

const seaProfile: PhotoProfile = {
	v: 1,
	subjectBox: null,
	faceBoxes: [],
	maskKey: null,
	colorTemp: "warm",
	brightness: "bright",
	saturation: "normal",
	dominantColors: [],
	composition: "wide",
	scene: "outdoor",
	peopleCount: "0",
	mood: "quiet",
	description: "傍晚海边的礁石与归航的渔船",
};

function bookInput(): Record<string, unknown> {
	return {
		version: 1,
		chapters: [
			{
				chapterId: "c1",
				photos: [
					// 存量书的 sceneDescription 在 engine 侧恒空 —— 档案是唯一能搜到的描述。
					{ photoId: "p1", sceneDescription: "", profile: seaProfile },
					{ photoId: "p2", sceneDescription: "厨房里的红烧肉" },
					{ photoId: "p3", sceneDescription: "" },
					{ photoId: "p4", sceneDescription: "" },
					{ photoId: "p5", sceneDescription: "" },
					{ photoId: "p6", sceneDescription: "" },
					{ photoId: "p7", sceneDescription: "" },
				],
			},
		],
		pages: [
			{ pageIndex: 0, templateId: "mag-01", images: { image: "p1" }, texts: {} },
			{ pageIndex: 1, templateId: "mag-05", images: { image: "p2" }, texts: {} },
		],
	};
}

function createHarness(options?: { withSeam?: boolean }): {
	tools: Map<string, AgentTool>;
	requested: string[][];
} {
	const catalog = loadTemplateCatalog();
	let book = parseAlbumBookInput(bookInput()).book;
	const requested: string[][] = [];
	const toolOptions: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
		...(options?.withSeam === false
			? {}
			: {
					lookAtPhotos: async (photoIds: string[]) => {
						requested.push(photoIds);
						return photoIds.map((photoId) => ({
							photoId,
							data: "iVBORw0KGgo=",
							mimeType: "image/jpeg",
						}));
					},
				}),
	};
	return {
		tools: new Map(createAlbumTools(toolOptions).map((tool) => [tool.name, tool as AgentTool])),
		requested,
	};
}

async function call(tools: Map<string, AgentTool>, name: string, input: unknown) {
	const tool = tools.get(name);
	assert.ok(tool, `tool ${name} 不存在`);
	const params = tool.prepareArguments ? tool.prepareArguments(input) : input;
	return await tool.execute("test-call", params as never);
}

async function runText(tools: Map<string, AgentTool>, name: string, input: unknown): Promise<string> {
	const result = await call(tools, name, input);
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

test("look_at_photos 一次最多 6 张", async () => {
	// 真图进上下文很贵；#307 刚因为这个把整页 HTML 改成默认不发。
	const { tools, requested } = createHarness();
	await assert.rejects(
		() => call(tools, "look_at_photos", { photoIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] }),
		/6/,
	);
	assert.equal(requested.length, 0, "超限就不该真的去取图");
});

test("look_at_photos 6 张是合法上限", async () => {
	const { tools, requested } = createHarness();
	await call(tools, "look_at_photos", { photoIds: ["p1", "p2", "p3", "p4", "p5", "p6"] });
	assert.deepEqual(requested[0], ["p1", "p2", "p3", "p4", "p5", "p6"]);
});

test("look_at_photos 把真图作为 image content 返回给模型", async () => {
	const { tools } = createHarness();
	const result = await call(tools, "look_at_photos", { photoIds: ["p1"] });
	const images = result.content.filter((block) => block.type === "image");
	assert.equal(images.length, 1);
	assert.equal((images[0] as { mimeType: string }).mimeType, "image/jpeg");
});

test("look_at_photos 的 photoId 不属于本书时被拒", async () => {
	const { tools, requested } = createHarness();
	await assert.rejects(() => call(tools, "look_at_photos", { photoIds: ["ghost"] }), /ghost/);
	assert.equal(requested.length, 0);
});

test("look_at_photos 空清单被拒", async () => {
	const { tools } = createHarness();
	await assert.rejects(() => call(tools, "look_at_photos", { photoIds: [] }), /photoIds/);
});

test("没注入取图 seam 时不注册 look_at_photos", () => {
	const names = [...createHarness({ withSeam: false }).tools.keys()];
	assert.ok(!names.includes("look_at_photos"));
});

test("工具描述写明这是兜底，不是默认输入", () => {
	const description = createHarness().tools.get("look_at_photos")?.description ?? "";
	assert.match(description, /档案|先读|兜底/);
});

test("look_at_photos 不终止工具循环 —— 它是读工具，模型看完还要接着干活", async () => {
	const { tools } = createHarness();
	const result = await call(tools, "look_at_photos", { photoIds: ["p1"] });
	assert.notEqual(result.terminate, true);
});

// ── 清死账:sceneDescription 在 engine 侧恒空 ──────────────────────────────

test("search_book 能搜到档案里的描述", async () => {
	// 修死账:sceneDescription 恒空(tree_builder.py:157 写死 ""),这条分支一直搜不到东西。
	const { tools } = createHarness();
	const text = await runText(tools, "search_book", { query: "海边" });
	assert.notEqual(text, "(no matches)");
	assert.match(text, /p1/);
});

test("search_book 仍然搜得到 sceneDescription（存量书回填后也有值）", async () => {
	const { tools } = createHarness();
	const text = await runText(tools, "search_book", { query: "红烧肉" });
	assert.match(text, /p2/);
});

test("同一张照片两处描述都命中时只报一次", async () => {
	const { tools } = createHarness();
	const text = await runText(tools, "search_book", { query: "海边" });
	const hits = text.split("\n").filter((line) => line.includes('"p1"'));
	assert.equal(hits.length, 1, `同一张照片重复上榜会挤掉其它命中：\n${text}`);
});

test("skills 里不再教 Agent 用 sceneDescription 这个死字段", () => {
	// 这个字段在 engine 侧恒空，指令一直是空转。
	const text = JSON.stringify(createDefaultAlbumSkills());
	assert.ok(!text.includes("sceneDescription"), "skills 里还在教模型用一个恒空的字段");
});

test("skills 改成指向照片档案", () => {
	const text = JSON.stringify(createDefaultAlbumSkills());
	assert.match(text, /profile|档案/);
});

// ── 照片处理技能:什么时候用档案、什么时候才准看图 ──────────────────────

// 生产环境读的是 packages/contracts/skills/<name>/SKILL.md,createDefaultAlbumSkills
// 只是目录缺失时的兜底 —— 两处都要过,只改代码里那份等于线上没改。
const skillSources: Array<[string, () => ReturnType<typeof createDefaultAlbumSkills>]> = [
	["内置兜底", () => createDefaultAlbumSkills()],
	["skills/ 文件", () => loadAlbumSkills()],
];

function photoSkill(skills = createDefaultAlbumSkills()) {
	return skills.find((skill) => /照片/.test(skill.name));
}

test("有一条专讲照片处理的技能", () => {
	const skill = photoSkill();
	assert.ok(skill, `skills 名称：${createDefaultAlbumSkills().map((s) => s.name).join("、")}`);
	assert.ok(skill.description.length > 0);
});

test("照片技能覆盖四个新工具", () => {
	const content = photoSkill()?.content ?? "";
	for (const tool of ["set_image_pos", "set_photo_filter", "set_photo_cutout", "look_at_photos"]) {
		assert.ok(content.includes(tool), `技能里没提到 ${tool}`);
	}
});

test("照片技能写明构图优先用 fit 意图，别自己算坐标", () => {
	const content = photoSkill()?.content ?? "";
	assert.match(content, /fit/);
	assert.match(content, /center-subject/);
});

test("照片技能写明抠图逐张开、不做整本默认全抠", () => {
	const content = photoSkill()?.content ?? "";
	assert.match(content, /逐张/);
});

test("照片技能写明 look_at_photos 是兜底且有张数上限", () => {
	const content = photoSkill()?.content ?? "";
	assert.match(content, /兜底/);
	assert.match(content, /6/);
});

test("照片技能提醒改滤镜可能影响已分享的书", () => {
	// 工具结果的 notes 会带 warning，模型要知道那是必须转告用户的东西。
	assert.match(photoSkill()?.content ?? "", /分享/);
});

for (const [label, load] of skillSources) {
	test(`${label}的 skills 里都不再教 sceneDescription`, () => {
		assert.ok(!JSON.stringify(load()).includes("sceneDescription"));
	});

	test(`${label}的 skills 里都有照片处理技能，且覆盖四个新工具`, () => {
		const content = photoSkill(load())?.content ?? "";
		for (const tool of ["set_image_pos", "set_photo_filter", "set_photo_cutout", "look_at_photos"]) {
			assert.ok(content.includes(tool), `${label}的照片技能里没提到 ${tool}`);
		}
	});
}
