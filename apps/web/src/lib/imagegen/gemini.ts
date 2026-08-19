// Gemini 生图(生产 provider)。
//
// **未对真实 API 验证过。** 小雨本机的代理把 googleapis.com 路由到 Google 不服务的
// 节点(返回 `User location is not supported`),绕开代理又被墙,所以本地一张都没能
// 真跑。下面按官方 generateContent 的文档形状实现,单测用 fake fetch 覆盖解析与
// 错误分类。上线前必须补一轮真实调用,见 spec「上线前必须验证的前置条件」。

import { ImageGenError, type GeneratedImage, type ImageProvider, type ImageRequest } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';

// Gemini 收宽高比,不收像素尺寸。取官方支持的一组,按实际宽高比就近匹配。
const ASPECT_RATIOS: { label: string; value: number }[] = [
  { label: '1:1', value: 1 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '9:16', value: 9 / 16 },
  { label: '16:9', value: 16 / 9 },
];

export function nearestAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best = ASPECT_RATIOS[0]!;
  for (const candidate of ASPECT_RATIOS) {
    if (Math.abs(candidate.value - target) < Math.abs(best.value - target)) best = candidate;
  }
  return best.label;
}

type InlineDataPart = { inlineData?: { mimeType?: string; data?: string } };
type GeminiResponse = {
  candidates?: { content?: { parts?: InlineDataPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

const SAFETY_FINISH_REASONS = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST']);

export function createGeminiProvider(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): ImageProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.model ?? GEMINI_IMAGE_MODEL;

  return {
    name: 'gemini',
    async generate(input: ImageRequest): Promise<GeneratedImage> {
      let response: Response;
      try {
        response = await doFetch(`${BASE_URL}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            // key 走 header 不拼 URL:URL 会落进日志和错误上报。
            'x-goog-api-key': opts.apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: input.prompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: nearestAspectRatio(input.width, input.height) },
            },
          }),
        });
      } catch (e) {
        throw new ImageGenError('upstream', `gemini: fetch failed ${String(e)}`);
      }

      const text = await response.text();
      let payload: GeminiResponse;
      try {
        payload = JSON.parse(text) as GeminiResponse;
      } catch {
        throw new ImageGenError('upstream', `gemini: HTTP ${response.status} ${text.slice(0, 200)}`);
      }

      if (payload.promptFeedback?.blockReason) {
        throw new ImageGenError('safety', `gemini: blocked ${payload.promptFeedback.blockReason}`);
      }
      if (payload.error) {
        throw new ImageGenError('upstream', `gemini: ${payload.error.status ?? ''} ${payload.error.message ?? ''}`.trim());
      }
      if (!response.ok) {
        throw new ImageGenError('upstream', `gemini: HTTP ${response.status} ${text.slice(0, 200)}`);
      }

      const candidate = payload.candidates?.[0];
      if (candidate?.finishReason && SAFETY_FINISH_REASONS.has(candidate.finishReason)) {
        throw new ImageGenError('safety', `gemini: finishReason ${candidate.finishReason}`);
      }

      const inline = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new ImageGenError('empty', 'gemini: no image part in response');

      return {
        bytes: Uint8Array.from(Buffer.from(inline.data, 'base64')),
        mime: inline.mimeType ?? 'image/png',
      };
    },
  };
}
