'use client';

import type { ClusterGeo } from './cluster';

// 反地理编码:GPS 坐标 → 地名文字。在浏览器内完成,**坐标永不出浏览器**。
//
// 隐私边界(architecture §3 / #232 carve-out 的更新版):此前连地名都不许离开浏览器
// (只留 clusterId)。产品决定放开「地名文字」这一层——用户体验需要在采访里预填「地点:杭州」。
// 但坐标(lat/lng)依然止步于浏览器:这里把每组照片的 GPS 反查成一个**城市级地名字符串**,
// 只有这个字符串会随采访答案带出去。lat/lng 绝不进请求体 / 日志 / IndexedDB。
//
// 服务:BigDataCloud client-side reverse-geocode(免费、无需 key、无需后端代理)。
// 只取到城市/区域粒度(我们只要「杭州」这种,不要街道门牌)。失败/无网络 => 返回 null,
// 采访退化为让用户自己手打地点,不挡流程。

const BIGDATACLOUD_ENDPOINT =
  'https://api-bdc.net/data/reverse-geocode-client';

/** 单次反查的最长等待;超时即放弃(采访地点回退手填,不阻塞)。 */
const GEOCODE_TIMEOUT_MS = 4000;

/**
 * 把一个 GPS 点反查成城市级地名(如「杭州」「Kyoto」)。纯客户端调用,坐标不落库。
 * 任何失败(网络 / 超时 / 无结果)都返回 null —— 调用方据此回退到手填地点。
 */
export async function reverseGeocodeCity(
  geo: ClusterGeo,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    const url = `${BIGDATACLOUD_ENDPOINT}?latitude=${geo.lat}&longitude=${geo.lng}&localityLanguage=zh`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return pickCityName(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 BigDataCloud 响应里挑一个城市级地名。优先 city,退而 locality,再退 principalSubdivision。
 * 只取一层,不拼「省市区」全串——采访预填要短、可读。
 */
function pickCityName(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  for (const key of ['city', 'locality', 'principalSubdivision'] as const) {
    const value = d[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * 给「一组照片的 GPS 点集」定一个代表地名(一章一个地名,取众数)。
 *
 * 逐点反查会很多次请求,而一组照片多半在同一城市——所以先做**坐标粗粒度去重**
 * (四舍五入到 ~11km 网格),对每个不同网格反查一次,再按「命中该网格的照片数」加权,
 * 取出现最多的地名。坐标只在本函数内参与计算,出去的只有地名字符串。
 *
 * 返回代表地名,或 null(无 GPS / 全部反查失败)。
 */
export async function representativePlaceForGroup(
  geos: readonly (ClusterGeo | null | undefined)[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<string | null> {
  // 坐标量化到 0.1°(≈11km)网格,把同城的点归一,减少反查次数。
  const buckets = new Map<string, { geo: ClusterGeo; count: number }>();
  for (const geo of geos) {
    if (!geo) continue;
    const key = `${geo.lat.toFixed(1)},${geo.lng.toFixed(1)}`;
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { geo, count: 1 });
  }
  if (buckets.size === 0) return null;

  // 每个不同网格反查一次;按命中照片数加权累计到地名,取众数。
  const nameWeight = new Map<string, number>();
  for (const { geo, count } of buckets.values()) {
    const name = await reverseGeocodeCity(geo, { signal });
    if (!name) continue;
    nameWeight.set(name, (nameWeight.get(name) ?? 0) + count);
  }
  if (nameWeight.size === 0) return null;

  let best: string | null = null;
  let bestWeight = -1;
  for (const [name, weight] of nameWeight) {
    if (weight > bestWeight) {
      best = name;
      bestWeight = weight;
    }
  }
  return best;
}
