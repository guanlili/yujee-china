/**
 * 照片滤镜/抠图状态在 design-agent 侧的**本地镜像**。
 *
 * ⚠️ 真相源是 `apps/web/src/lib/photo/filter-state.ts`(持久化在 `albums.photo_filter`
 * 列,走 settingsRevision 那套 OCC)。这里之所以抄一份而不是 import:design-agent 是
 * `packages/**` 里的库,不能反向依赖 `apps/web`。两边漂移由
 * `test/album-photo-filter-tools.test.ts` 的机械守卫拦住 —— 它直接读 web 那个文件
 * 比对 LUT id 清单,清单一变就红。
 *
 * ⚠️ 契约铁律:`cutouts` **只认 `true`,关掉是删键,绝不写 `false`**。允许 `false` 会让
 * 「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义(web 侧注释有完整说明)。
 * 本文件的 patch 类型用 `null` 表达删键,任何地方都不许出现 `false`。
 */

/** 26 个确定性 LUT 的 id 清单。逐字镜像 web 侧 LUT_DEFINITIONS 的顺序与拼写。 */
export const LUT_IDS = [
	"cloudy-cool",
	"street-negative",
	"airy-japanese",
	"travel-cinematic",
	"city-street",
	"daily-soft",
	"teal-orange-outdoor",
	"cool-cyan",
	"rich-teal-orange",
	"fuji-portrait",
	"night-film",
	"forest-green",
	"retro-film",
	"fuji-clear",
	"dark-cool-cinema",
	"kodak-daylight",
	"eighties-retro",
	"sunny-soft",
	"autumn-warm",
	"altay-wilderness",
	"warm-cinema-film",
	"muted-cinema",
	"nostalgic-film",
	"kodak-2383",
	"fresh-clear",
	"green-book",
] as const;

export type LutId = (typeof LUT_IDS)[number];

const LUT_ID_SET: ReadonlySet<string> = new Set(LUT_IDS);

export function isLutId(value: unknown): value is LutId {
	return typeof value === "string" && LUT_ID_SET.has(value);
}

export interface PhotoFilterRef {
	lutId: string;
	strength: number;
}

export interface PhotoFilterState {
	default: PhotoFilterRef | null;
	overrides?: Record<string, PhotoFilterRef | null>;
	/** 只认 true —— 关掉是删键。见文件抬头。 */
	cutouts?: Record<string, true>;
}

/**
 * 写入补丁:未出现的键 = 不动;`null` = 删键/置原片。
 * 形状与 web 侧 `applyAgentPhotoFilter(userId, albumId, patch, baseSettingsRevision)`
 * 的 patch 参数逐字对应。
 */
export interface PhotoFilterPatch {
	default?: PhotoFilterRef | null;
	overrides?: Record<string, PhotoFilterRef | null>;
	/** `true` = 开抠图,`null` = **删键**(关抠图)。永远不会是 `false`。 */
	cutouts?: Record<string, true | null>;
}

/** strength 归一化到 5 的倍数 —— 与 web 侧 quantizeStrength 同算法。
 * 两边算法必须一致:否则同一档强度在两侧算出不同的 renderVersion,分享快照直接失配。 */
export function quantizeStrength(value: number): number {
	return Math.round(value / 5) * 5;
}

/** 某张照片当前生效的滤镜:单张覆盖优先(含显式 null=原片),否则取全书默认。 */
export function resolveEffectiveFilter(
	state: PhotoFilterState | null | undefined,
	photoId: string,
): PhotoFilterRef | null {
	if (state?.overrides && Object.hasOwn(state.overrides, photoId)) {
		return state.overrides[photoId] ?? null;
	}
	return state?.default ?? null;
}

export function isCutout(state: PhotoFilterState | null | undefined, photoId: string): boolean {
	return state?.cutouts?.[photoId] === true;
}

/** 装书入口的宽容解析:结构不对就整体忽略(返回 null),绝不因为滤镜格式把整本书拒了。 */
export function parsePhotoFilterState(raw: unknown, warnings: string[]): PhotoFilterState | null {
	if (raw === undefined || raw === null) return null;
	if (!isRecord(raw)) {
		warnings.push("photoFilter 不是对象，已忽略");
		return null;
	}

	const state: PhotoFilterState = { default: parseFilterRef(raw.default) };

	if (isRecord(raw.overrides)) {
		const overrides: Record<string, PhotoFilterRef | null> = {};
		for (const [photoId, value] of Object.entries(raw.overrides)) {
			overrides[photoId] = parseFilterRef(value);
		}
		if (Object.keys(overrides).length > 0) state.overrides = overrides;
	}

	if (isRecord(raw.cutouts)) {
		const cutouts: Record<string, true> = {};
		for (const [photoId, value] of Object.entries(raw.cutouts)) {
			// 铁律:只认 true。存量/异常数据里的 false 一律当"没抠"处理并丢弃该键。
			if (value === true) cutouts[photoId] = true;
			else warnings.push(`photoFilter.cutouts["${photoId}"] 不是 true，已忽略（关抠图是删键，不写 false）`);
		}
		if (Object.keys(cutouts).length > 0) state.cutouts = cutouts;
	}

	return state;
}

function parseFilterRef(raw: unknown): PhotoFilterRef | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.lutId !== "string" || raw.lutId.length === 0) return null;
	if (typeof raw.strength !== "number" || !Number.isFinite(raw.strength)) return null;
	return { lutId: raw.lutId, strength: raw.strength };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── patch 合并 ───────────────────────────────────────────────────────────
//
// ⚠️ 与 web 侧 `apps/web/src/services/album/agent-photo-filter.ts` 的 `mergePatch`
// **同语义**,改一边要同步另一边。这里合并只为让本轮内存里的书立刻反映改动
// (read_page 要读得到新滤镜、新抠图状态);**落库的真相仍由 web 在 album 行锁内
// 用同一份语义重算** —— agent 不直接写库(album-server 抬头的既有约定)。
//
// 三个维度语义各不相同,别写混:
//   default   省略 = 不动;null = 整本回原片;ref = 整本换 LUT
//   overrides 逐 photoId 合并;值 null = 「这张显式用原片」**不是删键**
//             (删了键它会退回全书默认,语义完全相反)
//   cutouts   true = 开;null = **删键**(契约铁律:只认 true,绝不写 false)

/** patch 合并进现有状态。返回的状态里 cutouts 只会有 true,且全关时连壳一起删。 */
export function mergePhotoFilterPatch(
	current: PhotoFilterState | null | undefined,
	patch: PhotoFilterPatch,
): PhotoFilterState {
	const base: PhotoFilterState = current ?? { default: null };

	const nextOverrides: Record<string, PhotoFilterRef | null> = { ...(base.overrides ?? {}) };
	for (const [photoId, ref] of Object.entries(patch.overrides ?? {})) {
		nextOverrides[photoId] = normalizeRef(ref);
	}

	const nextCutouts: Record<string, true> = { ...(base.cutouts ?? {}) };
	for (const [photoId, on] of Object.entries(patch.cutouts ?? {})) {
		// 关掉 = delete。这一行是铁律的执行点,别改成 `nextCutouts[id] = false`。
		if (on === true) nextCutouts[photoId] = true;
		else delete nextCutouts[photoId];
	}

	return {
		default: Object.hasOwn(patch, "default") ? normalizeRef(patch.default ?? null) : normalizeRef(base.default),
		...(Object.keys(nextOverrides).length > 0 ? { overrides: nextOverrides } : {}),
		...(Object.keys(nextCutouts).length > 0 ? { cutouts: nextCutouts } : {}),
	};
}

/**
 * 累计两份 patch(一轮对话里模型可能调好几次工具,落库只发一份)。
 *
 * ⚠️ 不能改成「拿最终 state 反推 patch」:最终 state 里的 cutouts 只有 true,
 * 「这张关掉了」表现为键不存在,而 patch 里键不存在的语义是「没提到,别动」——
 * 反推会让**关抠图永远落不了库**。所以必须逐次累计,让 null 活到最后。
 */
export function combinePhotoFilterPatches(
	first: PhotoFilterPatch,
	second: PhotoFilterPatch,
): PhotoFilterPatch {
	const out: PhotoFilterPatch = {};
	if (Object.hasOwn(second, "default")) out.default = second.default ?? null;
	else if (Object.hasOwn(first, "default")) out.default = first.default ?? null;

	const overrides = { ...(first.overrides ?? {}), ...(second.overrides ?? {}) };
	if (Object.keys(overrides).length > 0) out.overrides = overrides;

	const cutouts = { ...(first.cutouts ?? {}), ...(second.cutouts ?? {}) };
	if (Object.keys(cutouts).length > 0) out.cutouts = cutouts;

	return out;
}

export function isEmptyPhotoFilterPatch(patch: PhotoFilterPatch | null | undefined): boolean {
	if (!patch) return true;
	return (
		!Object.hasOwn(patch, "default") &&
		Object.keys(patch.overrides ?? {}).length === 0 &&
		Object.keys(patch.cutouts ?? {}).length === 0
	);
}

/** 两个滤镜状态实质相同?(null 与「空状态」视作同一件事) 同值重写不该刷分享警报。 */
export function photoFilterStatesEqual(
	a: PhotoFilterState | null | undefined,
	b: PhotoFilterState | null | undefined,
): boolean {
	return stableKey(a) === stableKey(b);
}

function stableKey(state: PhotoFilterState | null | undefined): string {
	const value = state ?? { default: null };
	const overrides = Object.entries(value.overrides ?? {}).sort(([left], [right]) => (left < right ? -1 : 1));
	const cutouts = Object.keys(value.cutouts ?? {}).sort();
	return JSON.stringify([normalizeRef(value.default), overrides, cutouts]);
}

function normalizeRef(ref: PhotoFilterRef | null | undefined): PhotoFilterRef | null {
	return ref ? { lutId: ref.lutId, strength: quantizeStrength(ref.strength) } : null;
}
