import { createSign, createVerify } from 'node:crypto';

// Alipay OpenAPI 签名 / 验签(不引 SDK)。
//
// 为什么手写而不是装 alipay-sdk:仓库的支付面只有两条能力(生成收银台跳转 URL、
// 校验异步通知),SDK 带来的是一整套我们不会用到的 API 表面 + 一份需要长期跟的
// 依赖。RSA2 签名本身是 10 行确定性代码,签名/验签都能被单测钉死,反而更可控。
//
// 规则(官方文档「签名与验签」):
//   1. 剔除 sign、sign_type 两个字段,其余按 key 的字典序排序;
//   2. 拼成 k1=v1&k2=v2(值用原值,不做 URL 编码);
//   3. RSA-SHA256 签名,base64 输出,参数名 sign,sign_type=RSA2。
// 异步通知的验签用支付宝公钥,与签名用的应用私钥是不同的两把钥匙。

/** 参与签名的字段集合:除 sign 与 sign_type 之外的全部参数,按字典序拼接。 */
export function canonicalString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${params[k] ?? ''}`)
    .join('&');
}

/** RSA2(SHA256withRSA)签名,返回 base64。 */
export function signParams(params: Record<string, string>, privateKey: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(canonicalString(params), 'utf8');
  signer.end();
  return signer.sign(privateKey, 'base64');
}

/** 用支付宝公钥校验异步通知。sign 缺失或验签失败一律 false,不抛。 */
export function verifyNotify(params: Record<string, string>, alipayPublicKey: string): boolean {
  const sign = params.sign;
  if (!sign) return false;
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(canonicalString(params), 'utf8');
    verifier.end();
    return verifier.verify(alipayPublicKey, sign, 'base64');
  } catch {
    return false;
  }
}

/**
 * 把已签名的参数拼到网关地址后,返回可直接让浏览器跳转的 URL。
 * 支付宝的 page pay 支持 GET 方式提交(参数出现在 query 里),因此这里不必生成
 * HTML 表单——与现有 `{ url }` 的 checkout 契约保持一致。
 */
export function buildSignedUrl(
  gateway: string,
  params: Record<string, string>,
  privateKey: string,
): string {
  const signed = { ...params, sign: signParams(params, privateKey) };
  const query = new URLSearchParams(signed).toString();
  return `${gateway}?${query}`;
}

/** 支付宝要求 timestamp 为北京时间 `YYYY-MM-DD HH:mm:ss`。 */
export function alipayTimestamp(now: Date = new Date()): string {
  // 东八区是固定偏移,没有夏令时,直接加 8 小时比拉时区库更可靠。
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 19).replace('T', ' ');
}
