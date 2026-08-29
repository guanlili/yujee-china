import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AlbumBookState,
	cloneAlbumBookState,
	parseAlbumBookInput,
} from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

/* set_text_colors 对比度硬校验（2026-08-29 设计：.superpowers/sdd/2026-08-29-
   agent-style-understanding/task-7-brief.md）：这个工具能把字刷成任意色，深底书上刷
   深字就整页读不了，而 AI 看不见渲染结果、不会自己发现。写入前必须对每页「实际底色 vs
   拟写入字色」做 WCAG 对比度体检，不达 4.5:1 就整批拒绝并报出哪几页、实测多少。 */

const fixturePath = fileURLToPath(new URL("../fixtures/sample-book.json", import.meta.url));

function createHarness() {
	const catalog = loadTemplateCatalog();
	let book: AlbumBookState = parseAlbumBookInput(JSON.parse(readFileSync(fixturePath, "utf8"))).book;
	const options: AlbumToolsOptions = {
		catalog,
		getBookState: () => cloneAlbumBookState(book),
		setBookState: (next) => {
			book = cloneAlbumBookState(next);
		},
	};
	const tools = new Map(createAlbumTools(options).map((tool) => [tool.name, tool]));
	return {
		tools,
		getBook: () => book,
		setBook: (next: AlbumBookState) => {
			book = cloneAlbumBookState(next);
		},
	};
}

test("在深底页上刷深字被打回，报错说清哪几页、实测多少", async () => {
	const { tools, getBook } = createHarness();
	// 先把第 1 页刷成蓝底
	await tools.get("set_page_background")!.execute("c1", { pages: [1], colorId: "ivory" } as never);
	const book = getBook();
	book.pages[1]!.texts["#pageBackground"] = "#2D6DB0"; // 深蓝底
	// 再刷深字
	await assert.rejects(
		() => tools.get("set_text_colors")!.execute("c2", { titleColor: "#1A1A14" } as never),
		(err: Error) => {
			assert.match(err.message, /对比度/);
			assert.match(err.message, /1\.\d\d|2\.\d\d|3\.\d\d/); // 报出实测值
			return true;
		},
	);
});

test("浅底页上刷深字正常通过", async () => {
	const { tools, getBook } = createHarness();
	await tools.get("set_text_colors")!.execute("c1", { titleColor: "#1C1B18" } as never);
	assert.equal(getBook().pages[1]!.texts["title#accentColor"], "#1C1B18");
});

test("没有页底色的页按纯白判定（模板默认 background:#fff）", async () => {
	const { tools } = createHarness();
	await assert.rejects(
		() => tools.get("set_text_colors")!.execute("c1", { bodyColor: "#F5F2E8" } as never), // 白底浅字
		/对比度/,
	);
});

test("换到 mag-62（模板自带深底，未经过 set_page_background）后刷深字必须被打回", async () => {
	// 评审复盘（2026-08-29）：Task 7 的对比度体检只查 page.texts[PAGE_BACKGROUND_
	// CARRIER_KEY]，没有查 Task 8 引入的 TEMPLATE_OWN_BACKGROUND。mag-62/mag-63/p01
	// 这几个模板自带深底，页面只要没走过 set_page_background（没有显式 #pageBackground
	// carrier），旧实现会把它当白底放行——评审用这条路径实测复现了 1.343:1。
	// 修法：改用 effectivePageBackground（Task 8 已经写好「carrier 优先 → 模板自带
	// 深底 → 白底」的正确优先级），这里补一条测试钉住。
	const { tools, getBook } = createHarness(); // 封面 mag-01（editorial），1 图槽
	const swapTool = tools.get("swap_page_template")!;
	// 封面换成 mag-62：category 都是 cover、图槽数都是 1，可以直接换。
	await swapTool.execute("s1", swapTool.prepareArguments!({ pageNo: "cover", templateId: "mag-62" }) as never);
	assert.equal(getBook().pages[0]!.templateId, "mag-62");
	assert.equal(getBook().pages[0]!.texts["#pageBackground"], undefined, "没有显式 carrier 才是这个缺口的真实场景");

	await assert.rejects(
		() => tools.get("set_text_colors")!.execute("c1", { titleColor: "#1A1A14" } as never),
		(err: Error) => {
			assert.match(err.message, /对比度/);
			assert.match(err.message, /1\.\d\d/); // #12363A 配 #1A1A14 实测约 1.34:1
			return true;
		},
	);
});

/* ───────── set_text_colors 在多巴胺书上不能只会打回(最终评审 Important 3) ─────────
   多巴胺书每页底色不同:淡黄是浅底(配浅字 1.05)、橙是深底(配深字 3.46)—— **没有任何
   一个 hex 能同时过这两页**。评审实测 #F5F2E8 / #1A1A14 / #FFF / #000 四个全被打回,
   而「相册配色」和「风格理解」两个技能都还在往这个工具身上指,模型会反复撞墙;更糟的是
   旧文案给的两个建议色(两个 ink)在这种书上本身都不可用,是误导。
   要求:识别出「统一刷一个字色这件事做不到」,并给模型一条**可行的出路**。          */

/** 这本书每页的实际底色(与工具内部 effectivePageBackground 同口径的测试侧读法)。 */
function pageBackgrounds(book: AlbumBookState): string[] {
	const own: Record<string, string> = { "mag-62": "#12363A", "mag-63": "#12363A", p01: "#1C1B18" };
	return book.pages.map((p) => p.texts["#pageBackground"] ?? own[p.templateId] ?? "#FFFFFF");
}

async function setupDopamineHarness() {
	const h = createHarness();
	await h.tools.get("apply_book_style")!.execute("s", { styleId: "dopamine" } as never);
	const bgs = pageBackgrounds(h.getBook());
	// fixture 前提:这本书必须真的深浅混着,否则下面几条测的就不是这个场景。
	assert.ok(new Set(bgs).size > 1, `fixture 失效:多巴胺书的底色没有分化 ${bgs.join(",")}`);
	assert.ok(
		bgs.some((b) => ["#F3F0A8", "#9F82E8"].includes(b.toUpperCase())) &&
			bgs.some((b) => ["#C83E18", "#107E47", "#2D6DB0"].includes(b.toUpperCase())),
		`fixture 失效:必须同时有浅底页和深底页 ${bgs.join(",")}`,
	);
	return h;
}

test("多巴胺书上:四个候选字色全被打回,但报错要说清「统一刷做不到」并给出两条可行出路", async () => {
	const { tools } = await setupDopamineHarness();
	for (const color of ["#F5F2E8", "#1A1A14", "#FFFFFF", "#000000"]) {
		await assert.rejects(
			() => tools.get("set_text_colors")!.execute("c", { titleColor: color } as never),
			(err: Error) => {
				assert.match(err.message, /对比度/, `${color}:实测证据不能丢`);
				assert.match(err.message, /做不到/, `${color}:必须说清统一刷一个字色这件事做不到`);
				assert.match(err.message, /apply_book_style/, `${color}:要给出「改整体气质」这条出路`);
				assert.match(err.message, /set_page_background/, `${color}:要给出「改某几页观感」这条出路`);
				return true;
			},
		);
	}
});

test("多巴胺书上的报错不许再推荐那两个本身就不可用的 ink", async () => {
	const { tools } = await setupDopamineHarness();
	const err = await tools
		.get("set_text_colors")!
		.execute("c", { titleColor: "#1A1A14" } as never)
		.then(() => null, (e: Error) => e);
	assert.ok(err);
	assert.doesNotMatch(err!.message, /深底配浅字|浅底配深字/, "这本书上这条建议是假的,给了就是误导");
	assert.doesNotMatch(err!.message, /#F5F2E8/, "浅字在淡黄页上只有 1.05:1,不能当建议给");
});

test("全书底色统一时行为不变:照样按对比度打回,并推荐**这本书真的能用**的那个字色", async () => {
	const { tools } = createHarness(); // fixture 是浅底 editorial 书
	const bgTool = tools.get("set_page_background")!;
	await bgTool.execute("b", bgTool.prepareArguments({ pages: "all", colorId: "ivory" }) as never);
	const err = await tools
		.get("set_text_colors")!
		.execute("c", { bodyColor: "#F5F2E8" } as never) // 浅底刷浅字
		.then(() => null, (e: Error) => e);
	assert.ok(err, "统一底色上的对比度硬校验绝不能被这次改动放松");
	assert.match(err!.message, /对比度/);
	assert.match(err!.message, /#1A1A14/, "浅底该推荐深字");
	assert.doesNotMatch(err!.message, /做不到/, "统一底色不是「做不到」那条路");
	// 旧文案把两个 ink 一起端出来,其中一个在这本书上必然不可用 —— 只报能用的那个。
	assert.doesNotMatch(err!.message, /深底配浅字/, "浅底书上「深底配浅字」这半句是噪音");
});

test("底色统一且颜色合法时照常写入(没有被新分支误伤)", async () => {
	const { tools, getBook } = createHarness();
	const bgTool = tools.get("set_page_background")!;
	await bgTool.execute("b", bgTool.prepareArguments({ pages: "all", colorId: "ivory" }) as never);
	await tools.get("set_text_colors")!.execute("c", { titleColor: "#1A1A14" } as never);
	assert.equal(getBook().pages[1]!.texts["title#accentColor"], "#1A1A14");
});

test("底色不统一但确实存在一个能过全书的字色时,照写不误(不是一刀切拒绝)", async () => {
	// 浅底 + 更浅底混排:深字在两页上都过得了 4.5,那就没有理由拦。
	const { tools, getBook } = createHarness();
	const bgTool = tools.get("set_page_background")!;
	await bgTool.execute("b1", bgTool.prepareArguments({ pages: "all", colorId: "ivory" }) as never);
	await bgTool.execute("b2", bgTool.prepareArguments({ pages: [1], colorId: "ash" }) as never);
	const bgs = new Set(pageBackgrounds(getBook()));
	assert.ok(bgs.size > 1, "fixture 前提:底色确实不统一");
	await tools.get("set_text_colors")!.execute("c", { titleColor: "#1A1A14" } as never);
	assert.equal(getBook().pages[1]!.texts["title#accentColor"], "#1A1A14");
});
