// 传输类失败(照片快照 PUT / 导出上传)的原因归类,**封闭词表**。
//
// 为什么不能直接记 erro.message:这些请求的错误里经常夹着预签名 URL
// (https://cos...?q-sign-algorithm=...&q-signature=...),那是密钥级内容。
// 一旦原文落进 analytics_events,等于把上传地址和签名写进了数据库,还能被看板拉出来。
// 地名/坐标同样不可预测,正则兜不住 —— 所以只允许下面这几种,认不出的落 other,
// **绝不回落成原文**。这条和 events.ts 里「meta 只允许短、可枚举的信息」是同一条红线。
export const TRANSFER_FAILURE_CODES = ['network', 'other'] as const;

export type TransferFailureCode = (typeof TRANSFER_FAILURE_CODES)[number] | `http_${number}`;

const NETWORK_PATTERN = /network|fetch failed|load failed|failed to fetch|ERR_/i;

/**
 * 把任意异常收敛成一个可入库的失败码。优先用 HTTP 状态码(最准),
 * 其次按网络类关键词归 network,最后 other。
 */
export function classifyTransferFailure(err: unknown): TransferFailureCode {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && Number.isFinite(status)) return `http_${status}`;
  const message = err instanceof Error ? err.message : '';
  if (NETWORK_PATTERN.test(message)) return 'network';
  return 'other';
}
