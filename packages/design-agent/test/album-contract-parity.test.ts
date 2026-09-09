import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Page, V3LayoutTree } from "@yujee/contracts";
import { cloneAlbumBookState, parseAlbumBookInput } from "../src/core/album/book-state.ts";
import { loadTemplateCatalog } from "../src/core/album/templates-catalog.ts";
import { type AlbumToolsOptions, createAlbumTools } from "../src/core/album/tools.ts";

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

test("PhotoProfile 的本地类型 shim 与 contracts 真相源字段一致", () => {
	const shimPath = fileURLToPath(new URL("../src/types/contracts-photo-profile.d.ts", import.meta.url));
	const contractPath = fileURLToPath(new URL("../../contracts/src/photo-profile.ts", import.meta.url));

	const contractSource = readFileSync(contractPath, "utf8");
	const body = contractSource
		.split("export const PhotoProfileSchema = z.object({")[1]
		?.split("}).strict();")[0];
	assert.ok(body, "契约文件结构变了 —— PhotoProfileSchema 的对象体没找到");
	const contractFields = new Set([...body.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]));

	const shimSource = readFileSync(shimPath, "utf8");
	const shimBody = shimSource.split("export interface PhotoProfile {")[1]?.split("\n}")[0];
	assert.ok(shimBody, "shim 里没有 PhotoProfile 接口");
	const shimFields = new Set([...shimBody.matchAll(/^\t(\w+)[?]?:/gm)].map((match) => match[1]));

	assert.deepEqual(
		[...shimFields].sort(),
		[...contractFields].sort(),
		"契约漂移：design-agent 的 PhotoProfile shim 与 packages/contracts 的字段对不上",
	);
});
