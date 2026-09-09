/**
 * 滤镜/抠图的**本地** seam(不开跨服务回调)。
 *
 * 既有约定(album-server 抬头):agent 不直接写库,写入后的书由 /api/chat 响应带回,
 * 由调用方负责持久化。滤镜没理由破例 —— 破例就要额外开一条 agent → web 的写入
 * 鉴权通道,而这条通道的每一次调用都还要自己处理 OCC。
 *
 * 所以这个 seam 只做三件事:
 *   ① 把 patch 合进内存里的书(同一轮里 read_page 要立刻读得到新滤镜/抠图状态)
 *   ② 累计 patch,由 /api/chat 响应带回,web 拿它调 applyAgentPhotoFilter 落库
 *   ③ 书已发布过分享时给一条提醒,进工具结果的 notes,让 Agent 转告用户
 *
 * ⚠️ ②必须是**累计 patch**,不能是「拿最终状态反推」:最终状态里 cutouts 只有
 * true,「这张关掉了」表现为键不存在,而 patch 里键不存在的语义是「没提到,别动」
 * —— 反推会让关抠图永远落不了库。
 *
 * ⚠️ ③**不精确到 photoId**:要算「哪几张的 renderVersion 变了」就得在 agent 侧
 * 镜像 web 的 effectiveRenderVersion,白多一个漂移面。warning 的作用是提醒用户去
 * 重新备份,不需要精确到照片。真正的精确判定在 web 的 shareMismatchWarnings 里,
 * 那边拿得到备份集合。
 */

import {
	combinePhotoFilterPatches,
	isEmptyPhotoFilterPatch,
	mergePhotoFilterPatch,
	type PhotoFilterPatch,
	type PhotoFilterState,
	photoFilterStatesEqual,
} from "../core/album/photo-filter.ts";

export interface PhotoFilterSeamOptions {
	getState: () => PhotoFilterState | null | undefined;
	setState: (next: PhotoFilterState) => void;
	hasPublishedShare: () => boolean;
}

export interface PhotoFilterSeam {
	apply: (patch: PhotoFilterPatch) => Promise<{ warnings: string[] }>;
	/** 自上次 reset 以来累计的 patch;一次都没动过返回 null。 */
	pending: () => PhotoFilterPatch | null;
	/** 装书时清账:web 每轮对话前都会重新 POST /api/book,那时上一轮的 patch 已经落过库。 */
	reset: () => void;
}

const SHARE_WARNING =
	"这本书已经发布过分享链接。改滤镜/抠图会让照片的渲染版本变化,已发出的分享页会显示不出这些照片," +
	"需要在编辑器里重新备份全书后重新分享(备份单次上限 300 张,大书要分几次)。请在回复里告诉用户这件事。";

export function createPhotoFilterSeam(options: PhotoFilterSeamOptions): PhotoFilterSeam {
	let accumulated: PhotoFilterPatch | null = null;

	return {
		async apply(patch: PhotoFilterPatch): Promise<{ warnings: string[] }> {
			const before = options.getState() ?? null;
			const after = mergePhotoFilterPatch(before, patch);
			options.setState(after);
			accumulated = accumulated ? combinePhotoFilterPatches(accumulated, patch) : patch;

			// 同值重写(模型把同一个 LUT 又设了一遍)什么都没变,不刷假警报。
			const changed = !photoFilterStatesEqual(before, after);
			return { warnings: changed && options.hasPublishedShare() ? [SHARE_WARNING] : [] };
		},
		pending(): PhotoFilterPatch | null {
			return accumulated && !isEmptyPhotoFilterPatch(accumulated) ? accumulated : null;
		},
		reset(): void {
			accumulated = null;
		},
	};
}
