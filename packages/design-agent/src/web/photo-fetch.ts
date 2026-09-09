/**
 * look_at_photos 的取图通道:按需向 web 的 internal 端点要照片字节。
 *
 * 为什么不在装书时把图一起传过来:一本书几十张,base64 全塞进 /api/book 太贵,
 * 而看图是**兜底**路径 —— 绝大多数对话一张都不看。装书只传"哪些照片能看"
 * (viewablePhotoIds),真要看时才走这条路。
 *
 * 为什么不发签名 URL:pi-ai 的 `ImageContent` 只收 base64(`data` + `mimeType`),
 * 没有 URL 变体 —— 图终究要经过 agent 进程。(而且 `r2.signGetUrl` 默认 300s,
 * 一轮对话可能比它长。)
 *
 * 鉴权与 `job-progress` / `agent-data` / `photo-profiles` 同款:`AGENT_SHARED_SECRET`
 * 的 Bearer。请求体只送 albumId + photoIds,**不送 R2 key** —— key 由 web 侧从
 * (albumId, photoId) 推导并校验归属,免得这个 secret 变成任意对象读取的钥匙。
 */

export interface WebBridgeConfig {
	baseUrl: string;
	secret: string;
}

export interface WebPhotoFetcherOptions extends Partial<WebBridgeConfig> {
	baseUrl: string;
	albumId: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

export interface FetchedPhoto {
	photoId: string;
	/** base64(不带 data: 前缀)—— 直接进 pi-ai 的 ImageContent.data。 */
	data: string;
	mimeType: string;
}

export const PHOTO_BYTES_PATH = "/api/v3/internal/photo-bytes";

const DEFAULT_TIMEOUT_MS = 20_000;

/** 两样都配齐才算通 —— 缺一样就返回 undefined,album-server 据此**不注册**
 * look_at_photos(宁可没这个能力,也不让模型调一个必然 401/连不上的工具)。 */
export function resolveWebBridgeConfig(env: Record<string, string | undefined>): WebBridgeConfig | undefined {
	const baseUrl = env.WEB_BASE_URL?.trim();
	const secret = env.AGENT_SHARED_SECRET?.trim();
	if (!baseUrl || !secret) return undefined;
	return { baseUrl, secret };
}

export function createWebPhotoFetcher(
	options: WebPhotoFetcherOptions,
): (photoIds: string[]) => Promise<FetchedPhoto[]> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const endpoint = `${options.baseUrl.replace(/\/+$/, "")}${PHOTO_BYTES_PATH}`;

	return async (photoIds: string[]): Promise<FetchedPhoto[]> => {
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(options.secret ? { authorization: `Bearer ${options.secret}` } : {}),
			},
			body: JSON.stringify({ albumId: options.albumId, photoIds }),
			signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});

		if (!response.ok) {
			throw new Error(`取照片失败:web 返回 ${response.status}`);
		}

		const body = (await response.json()) as unknown;
		const photos = readPhotos(body);
		if (photos.length === 0) {
			// 一张都没取到就抛 —— 让模型知道它没看到图,别凭空编内容。
			throw new Error("这些照片的原图取不到(可能还没上传完成)。别猜照片内容,先告诉用户这件事。");
		}
		return photos;
	};
}

function readPhotos(body: unknown): FetchedPhoto[] {
	const data = isRecord(body) && isRecord(body.data) ? body.data : undefined;
	if (!data || !Array.isArray(data.photos)) {
		throw new Error("取照片失败:web 返回的形状不对(缺 data.photos)");
	}
	const out: FetchedPhoto[] = [];
	for (const entry of data.photos) {
		if (!isRecord(entry)) continue;
		if (typeof entry.photoId !== "string" || typeof entry.data !== "string" || typeof entry.mimeType !== "string") {
			continue;
		}
		out.push({ photoId: entry.photoId, data: entry.data, mimeType: entry.mimeType });
	}
	return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
