// 火山方舟(Ark)Seedream 生图 —— **本地开发 + 离线批量素材**用。
//
// 生产为什么不用它:Web 部署在 Vercel(美国),Ark 在北京。实测美国出口一张要 17s
// (API 12.7s + 从北京 TOS 下载 4.3s,速度只有 137 KB/s),而国内直连只要 5.6s。
// 小雨本机在国内,所以本地开发和 scripts/gen-board-bg.ts 走这条最快。
//
// Ark 只回图片 URL(24h 过期的签名地址),字节要自己取回来 —— 这是它和 Gemini
// 最大的结构差异,后者直接回 inlineData。

import { ImageGenError, type GeneratedImage, type ImageProvider, type ImageRequest } from './types';

const ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/** 这个账号下唯一开通的生图模型(4.5 / 3.0 实测都是 NotFound)。 */
// 模型名 env 可配(2026-10-30):管理后台可在线切换;env 是基础设施层默认值。
export const SEEDREAM_MODEL = process.env.ARK_IMAGE_MODEL ?? 'doubao-seedream-4-0-250828';

/** 实测下限:低于这个像素数直接 InvalidParameter「image size must be at least 921600 pixels」。 */
export const SEEDREAM_MIN_PIXELS = 921_600;

// Ark 的内容安全拒绝要和「上游坏了」分开:前者重试多少次都一样,得让用户改描述。
const SAFETY_CODES = [/sensitive/i, /content.*(policy|risk|violation)/i, /security/i];

/** 保持宽高比,把总像素抬到 Ark 的下限之上;已达标则原样返回。 */
export function fitToMinPixels(width: number, height: number): { width: number; height: number } {
  const pixels = width * height;
  if (pixels >= SEEDREAM_MIN_PIXELS) return { width: Math.round(width), height: Math.round(height) };
  const scale = Math.sqrt(SEEDREAM_MIN_PIXELS / pixels);
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale) };
}

type ArkResponse = {
  data?: { url?: string; size?: string }[];
  usage?: { output_tokens?: number };
  error?: { code?: string; message?: string };
};

export function createSeedreamProvider(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): ImageProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    name: 'ark',
    async generate(input: ImageRequest): Promise<GeneratedImage> {
      const size = fitToMinPixels(input.width, input.height);

      let response: Response;
      try {
        response = await doFetch(ENDPOINT, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model ?? SEEDREAM_MODEL,
            prompt: input.prompt,
            size: `${size.width}x${size.height}`,
            response_format: 'url',
            // 默认是 true。带水印的图印进用户的书里就是废品,这行不能删。
            watermark: false,
          }),
        });
      } catch (e) {
        throw new ImageGenError('upstream', `seedream: fetch failed ${String(e)}`);
      }

      const text = await response.text();
      let payload: ArkResponse;
      try {
        payload = JSON.parse(text) as ArkResponse;
      } catch {
        throw new ImageGenError('upstream', `seedream: HTTP ${response.status} ${text.slice(0, 200)}`);
      }

      if (payload.error) {
        const label = `${payload.error.code ?? ''} ${payload.error.message ?? ''}`.trim();
        const kind = SAFETY_CODES.some((re) => re.test(label)) ? 'safety' : 'upstream';
        throw new ImageGenError(kind, `seedream: ${label}`);
      }
      if (!response.ok) {
        throw new ImageGenError('upstream', `seedream: HTTP ${response.status} ${text.slice(0, 200)}`);
      }

      const first = payload.data?.[0];
      const url = first?.url;
      if (!url) throw new ImageGenError('empty', 'seedream: no image in response');
      // Ark 会回它实际用的尺寸(我们请求的可能被下限抬过)。解析失败就不报,让调用方回落。
      const echoed = /^(\d+)x(\d+)$/.exec(first?.size ?? '');

      let image: Response;
      try {
        image = await doFetch(url);
      } catch (e) {
        throw new ImageGenError('upstream', `seedream: image fetch failed ${String(e)}`);
      }
      if (!image.ok) {
        throw new ImageGenError('upstream', `seedream: image download HTTP ${image.status}`);
      }

      return {
        bytes: new Uint8Array(await image.arrayBuffer()),
        mime: 'image/jpeg',
        outputTokens: payload.usage?.output_tokens,
        ...(echoed ? { width: Number(echoed[1]), height: Number(echoed[2]) } : {}),
      };
    },
  };
}
