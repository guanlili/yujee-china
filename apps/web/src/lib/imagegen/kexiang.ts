// kexiangai 中转站生图(SeeDream4.5)—— 2026-10-28 起的生产 provider。
//
// 与前两家的结构差异:站方生图不是同步 images 接口,是**异步任务 API**
// (POST asyncCreateWithCost 创建 → GET passAuth/{id} 轮询 → 取 imgUrl 下载),
// 且鉴权用 `x-api-key: <原始 key>`(不带 sk- 前缀,与 chat 接口的 Bearer sk- 不同)。
//
// 尺寸语义也不同:只有 2K/4K 两档,**比例写进 prompt**(站方文档口径)。
// 这里把图槽的 WxH 归约成比例提示追加到 prompt 尾部;分辨率固定 2K
// (书页图槽不需要 4K,且 4K 计费翻倍)。
//
// 预算纪律:路由 maxDuration = 60s,轮询死线 50s,超时按 upstream 处理退积分。

import { ImageGenError, type GeneratedImage, type ImageProvider, type ImageRequest } from './types';

const BASE_URL = 'https://kexiangai.com/api/v1';
const CREATE_PATH = `${BASE_URL}/user_task/asyncCreateWithCost`;
const pollPath = (taskId: number | string) => `${BASE_URL}/user_task/get/passAuth/${taskId}`;

// 模型名 env 可配(2026-10-30):管理后台可在线切换。
const MODEL_NAME = process.env.KEXIANG_IMAGE_MODEL ?? 'SeeDream4.5';
/** 中转站按张计费:2K = 0.2 积分/张(1 积分 = 1 元),与 token 无关,台账的 outputTokens 留空。 */
const SIZE = '2K';

const SAFETY_PATTERN = /敏感|违规|内容|安全|policy|risk|violation|safety/i;

/** 轮询节奏:3s 一次;死线 50s(路由 maxDuration 60s 留 10s 给创建+下载)。 */
const POLL_INTERVAL_MS = 3_000;
const POLL_DEADLINE_MS = 50_000;

export interface KexiangProviderOptions {
  apiKey: string;
  /** 管理后台「模型设置」覆盖;缺省用 env/硬编码默认。 */
  model?: string;
  fetchImpl?: typeof fetch;
  /** 测试用:缩短轮询死线/间隔。 */
  pollDeadlineMs?: number;
  pollIntervalMs?: number;
}

type TaskRecord = {
  id?: number | string;
  task_status?: string;
  service_output?: { imgUrl?: string | null; imgUrls?: (string | null)[] | null; failReason?: string | null };
};

export function createKexiangProvider(opts: KexiangProviderOptions): ImageProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const deadlineMs = opts.pollDeadlineMs ?? POLL_DEADLINE_MS;
  const intervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;

  return {
    name: 'kexiang',
    async generate(input: ImageRequest): Promise<GeneratedImage> {
      const prompt = appendAspectRatio(input.prompt, input.width, input.height);

      const task = await createTask(doFetch, opts.apiKey, prompt, opts.model);
      const record = await pollTask(doFetch, opts.apiKey, task, deadlineMs, intervalMs);
      const url = extractImageUrl(record);
      const { bytes, mime } = await downloadImage(doFetch, url);

      return {
        bytes,
        mime,
        // 上游没有回报精确像素(比例由 prompt 控制),省略,调用方回落到请求值。
      };
    },
  };
}

/** WxH → 比例提示。先归约,比例失真(长边过大)时贴到常用比例,避免 "1667:2500" 这种提示词。 */
export function appendAspectRatio(prompt: string, width: number, height: number): string {
  const ratio = nearestRatio(width, height);
  return `${prompt}。画面比例 ${ratio}`;
}

const COMMON_RATIOS: Array<[number, number]> = [
  [1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9],
];

export function nearestRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  const w = width / divisor;
  const h = height / divisor;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  const target = Math.log(width / height);
  let best = COMMON_RATIOS[0];
  let bestDiff = Infinity;
  for (const [rw, rh] of COMMON_RATIOS) {
    const diff = Math.abs(Math.log(rw / rh) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [rw, rh];
    }
  }
  return `${best[0]}:${best[1]}`;
}

async function createTask(doFetch: typeof fetch, apiKey: string, prompt: string, model?: string): Promise<number | string> {
  let response: Response;
  try {
    response = await doFetch(CREATE_PATH, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        user_input: {
          modelName: model ?? MODEL_NAME,
          modelType: 'text2img',
          prompt,
          watermark: false,
          reference_images: [],
          size: SIZE,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ImageGenError('upstream', `kexiang: create fetch failed ${String(e)}`);
  }
  const payload = (await response.json().catch(() => null)) as { id?: number | string; msg?: string } | null;
  if (!response.ok || !payload?.id) {
    const message = payload?.msg ?? '';
    if (SAFETY_PATTERN.test(message)) {
      throw new ImageGenError('safety', `kexiang: rejected ${message}`);
    }
    throw new ImageGenError('upstream', `kexiang: create HTTP ${response.status} ${message}`.trim());
  }
  return payload.id;
}

async function pollTask(
  doFetch: typeof fetch,
  apiKey: string,
  taskId: number | string,
  deadlineMs: number,
  intervalMs: number,
): Promise<TaskRecord> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    let response: Response;
    try {
      response = await doFetch(pollPath(taskId), {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ImageGenError('upstream', `kexiang: poll fetch failed ${String(e)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ImageGenError('upstream', `kexiang: poll HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    const record = (await response.json().catch(() => null)) as TaskRecord | null;
    if (!record) {
      throw new ImageGenError('upstream', 'kexiang: poll returned unparsable payload');
    }
    const status = record.task_status ?? '';
    if (status === 'success') return record;
    if (status === 'failed' || status === 'fail' || status === 'error' || status === 'cancelled') {
      const reason = record.service_output?.failReason ?? status;
      if (SAFETY_PATTERN.test(String(reason))) {
        throw new ImageGenError('safety', `kexiang: task rejected ${reason}`);
      }
      throw new ImageGenError('upstream', `kexiang: task failed ${reason}`);
    }
    if (Date.now() >= deadline) {
      throw new ImageGenError('upstream', `kexiang: poll deadline exceeded (status=${status})`);
    }
    await sleep(intervalMs);
  }
}

function extractImageUrl(record: TaskRecord): string {
  const url = record.service_output?.imgUrl ?? record.service_output?.imgUrls?.find((u) => !!u) ?? '';
  if (!url) {
    // 状态 success 却没有图:按 empty 处理(上游回了但没出图),退积分、记上游异常。
    throw new ImageGenError('empty', 'kexiang: success without imgUrl');
  }
  return url;
}

async function downloadImage(doFetch: typeof fetch, url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  let response: Response;
  try {
    response = await doFetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new ImageGenError('upstream', `kexiang: image download failed ${String(e)}`);
  }
  if (!response.ok) {
    throw new ImageGenError('upstream', `kexiang: image download HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new ImageGenError('empty', 'kexiang: downloaded image is empty');
  }
  return { bytes, mime: response.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
