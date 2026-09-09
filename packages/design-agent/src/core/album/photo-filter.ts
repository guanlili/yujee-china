/**
 * 照片滤镜/抠图状态在 design-agent 侧的**本地镜像**。
 *
 * ⚠️ 真相源是 `apps/web/src/lib/photo/filter-state.ts`(持久化在 `albums.photo_filter`
 * 列,走 settingsRevision 那套 OCC)。这里之所以抄一份而不是 import:design-agent 是
 * `packages/**` 里的库,不能反向依赖 `apps/web`。
 *
 * ⚠️ 契约铁律:`cutouts` **只认 `true`,关掉是删键,绝不写 `false`**。允许 `false` 会让
 * 「没抠」有两种表示,renderVersion 和派生缓存 key 立刻产生歧义(web 侧注释有完整说明)。
 * 本文件的 patch 类型用 `null` 表达删键,任何地方都不许出现 `false`。
 */

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
