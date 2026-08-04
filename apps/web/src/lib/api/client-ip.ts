// 取请求方 IP(Vercel/代理场景):x-forwarded-for 首段是客户端真实 IP,
// 退而求其次 x-real-ip;都没有返回 null(调用方按「无法限流→放行」处理,
// 生产在 Vercel 后面这两个头必有)。纯函数吃 Headers,便于 node:test 直接构造。
export function clientIpFrom(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || null;
}
