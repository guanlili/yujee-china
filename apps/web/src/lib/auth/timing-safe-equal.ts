import { timingSafeEqual } from 'node:crypto';

/**
 * 常量时间字符串比较,用于 Bearer / 共享密钥等安全敏感串的判等。
 * 长度不等先返回 false(timingSafeEqual 对不同长度 Buffer 会抛),避免长度侧信道;
 * 长度相等时再走 timingSafeEqual,避免逐字符短路带来的时序侧信道。
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
