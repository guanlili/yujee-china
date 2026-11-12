// 前端拿到的对象存储地址**一律**走同源代理 `/api/v1/assets/<key>`,由后端回 302 到
// 预签名 GET。原因(2026-11-10 实测):国内 COS 桶是私有的 —— ACL 只有 owner 的
// FULL_CONTROL、从未配过 bucket policy,裸拼的 `https://<bucket>.cos.../<key>` 对匿名
// 读一律 403 + application/xml。浏览器对 `<img>` 这种 no-cors 请求会按响应的 MIME 判定
// 「这不是给页面用的资源」并整条拦掉,控制台只留 ERR_BLOCKED_BY_ORB,图是空白 ——
// 缩略图、封面、分享页照片、PDF 下载全中。
//
// 代理只回一个 302,字节仍由浏览器从存储直拉,所以「Web 层不代理字节」这条设计立场不变。
// 附带好处:URL 不再暴露存储直链,换存储/加防盗链都只改这一层。
export const ASSET_PROXY_PREFIX = '/api/v1/assets';

export function assetProxyPath(key: string): string {
  return `${ASSET_PROXY_PREFIX}/${key}`;
}

// 从各种历史形态(裸 COS/R2 绝对 URL、代理路径)里取出代理路径。
// 老数据是裸链(albums.cover_thumbnail_url / pdf_url / album_shares.snapshot_json
// 里都可能是),读侧统一过一遍这个函数,不必写迁移。
export function normalizeAssetUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith(`${ASSET_PROXY_PREFIX}/`)) return raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const path = new URL(raw).pathname;
      return path.startsWith('/') ? `${ASSET_PROXY_PREFIX}${path}` : raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

// normalizeAssetUrl 的逆运算:从 URL(可能是裸链或代理路径)里取出存储 key。
export function assetKeyFromUrl(raw: string): string | null {
  const proxy = normalizeAssetUrl(raw);
  if (!proxy || !proxy.startsWith(`${ASSET_PROXY_PREFIX}/`)) return null;
  return proxy.slice(ASSET_PROXY_PREFIX.length + 1).split('?')[0] ?? null;
}
