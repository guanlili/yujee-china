import type { AlbumPage } from "./book-state.ts";

/** 页序操作(内部 1 基位置,全部按调用前页序解析;寻址解析在工具层)。 */
export type PageMoveOperation =
	| { type: "move"; pageNo: number; before?: number; after?: number }
	| { type: "swap"; a: number; b: number };

/**
 * 身份锚定的页序重排:先把所有位置引用绑定到页对象,再逐条应用,
 * 前面的操作挪动了锚点页也不会错位。违规抛中文 Error,调用方零写入。
 */
export function applyPageMoves(
	pages: readonly AlbumPage[],
	isInterior: (page: AlbumPage) => boolean,
	operations: readonly PageMoveOperation[],
	labelOf: (originalNo: number) => string,
): AlbumPage[] {
	if (operations.length === 0) throw new Error("operations 至少要有一项");
	const byOriginal = (no: number): AlbumPage => {
		if (!Number.isInteger(no) || no < 1 || no > pages.length) throw new Error(`页 ${no} 不存在`);
		return pages[no - 1];
	};
	const requireInterior = (no: number): AlbumPage => {
		const page = byOriginal(no);
		if (!isInterior(page)) throw new Error(`${labelOf(no)}是封面/目录/封尾,只能挪内页`);
		return page;
	};

	const working = [...pages];
	for (const op of operations) {
		if (op.type === "swap") {
			if (op.a === op.b) throw new Error("swap 的两页不能相同");
			const a = requireInterior(op.a);
			const b = requireInterior(op.b);
			const ia = working.indexOf(a);
			const ib = working.indexOf(b);
			[working[ia], working[ib]] = [working[ib], working[ia]];
			continue;
		}
		if ((op.before === undefined) === (op.after === undefined))
			throw new Error("move 的 before/after 必须恰好给一个");
		const anchorNo = op.before ?? op.after!;
		if (anchorNo === op.pageNo) throw new Error("move 的锚点不能是自己");
		const source = requireInterior(op.pageNo);
		const anchor = byOriginal(anchorNo);
		working.splice(working.indexOf(source), 1);
		const at = working.indexOf(anchor) + (op.after !== undefined ? 1 : 0);
		working.splice(at, 0, source);
	}

	// 锚定通则:任何非内页记录的下标不许变(哪怕它意外出现在书中间)。
	pages.forEach((page, index) => {
		if (!isInterior(page) && working[index] !== page)
			throw new Error(`${labelOf(index + 1)}的位置不能被改变(封面/目录/封尾钉死)`);
	});
	if (working.every((page, index) => page === pages[index]))
		throw new Error("这些操作的净效果没有改变页序");
	return working;
}
