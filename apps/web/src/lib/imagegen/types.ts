// 生图 provider 的公共契约。两家实现:gemini(生产)/ seedream(本地开发 + 离线批量)。
// 选型理由见 docs/specs/2026-08-18-ai-image-generation-design.md:Web 部署在 Vercel
// (美国),Ark 在北京,生产链路要跨太平洋两个来回(实测 17s/张,其中 4.3s 是从北京
// TOS 下载图片);Gemini 同大洲且直接回 inlineData,没有第二趟下载。

export type ImageRequest = {
  prompt: string;
  width: number;
  height: number;
};

export type GeneratedImage = {
  bytes: Uint8Array;
  mime: string;
  /** 上游报的出量 token,用于成本核算;不是每家都给。 */
  outputTokens?: number;
  /**
   * 上游实际出图的像素尺寸。**不等于请求的尺寸**:Ark 会把低于像素下限的请求
   * 抬上去,Gemini 干脆只收宽高比。台账里记请求值就是记了个假数,所以要回报。
   * 上游没说的就省略,调用方回落到请求值。
   */
  width?: number;
  height?: number;
};

export interface ImageProvider {
  readonly name: string;
  generate(input: ImageRequest): Promise<GeneratedImage>;
}

/**
 * 失败分三类,因为**上层对它们的处理不同**(见 spec「失败路径」):
 * - `safety`  上游内容策略拒绝 -> 退积分、提示改描述、**不计入免费重生成次数**
 * - `upstream` 超时 / 5xx / 网络 -> 退积分、可重试
 * - `empty`   上游回了但没有图 -> 退积分,当上游异常记日志
 * 混成一种 Error 的话,用户被安全策略拦下时会看到「服务器开小差,请重试」,
 * 然后一直重试一直被拦。
 */
export type ImageGenErrorKind = 'safety' | 'upstream' | 'empty';

export class ImageGenError extends Error {
  readonly kind: ImageGenErrorKind;

  constructor(kind: ImageGenErrorKind, message: string) {
    super(message);
    this.name = 'ImageGenError';
    this.kind = kind;
  }
}
