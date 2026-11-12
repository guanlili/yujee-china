import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth/better-auth';
import { albumRepo } from '@/db/repos/album-repo';
import { albumMemberRepo } from '@/db/repos/album-member-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
import { r2 } from '@/lib/r2/r2-client';
import { logger } from '@/lib/log/logger';

// 资源出口:同源代理 → 302 到预签名 GET。
//
// 为什么需要它:桶是私有的(见 lib/r2/asset-url.ts 的注释),前端不能直接拿存储地址。
// 为什么是 302 而不是流式转发:字节由浏览器从存储直拉,Web 层只回一个 Location,
// 不占源站带宽,也不违背 r2-client.ts 里「Web tier 从不代理字节」的立场。
//
// 权限分级:
//   pdfs/           交付物,分享链接要能下 —— 公开(URL 含随机 UUID,不可枚举)
//   cover-thumbs/   相册封面,列表页要显示 —— 公开
//   photo-snapshots/ 私人照片备份 —— 需登录(本人/协作者)或持有效分享 token
//   photo-originals/ 原图 —— 需登录(本人/协作者)
const PUBLIC_PREFIXES = ['pdfs/', 'cover-thumbs/'];
const ALLOWED_KEY = /^(pdfs|cover-thumbs|photo-snapshots|photo-originals)\/[\w./-]+$/;
// 10 分钟:既够浏览器把图下完,又不会让一次泄露长期有效。
const SIGN_TTL_SECONDS = 600;

function notFound() {
  return new NextResponse('not found', { status: 404 });
}

async function redirectToObject(key: string): Promise<NextResponse> {
  const url = await r2.signGetUrl(key, SIGN_TTL_SECONDS);
  // 302 而非 307:GET 语义,浏览器按 GET 跟随即可。
  return NextResponse.redirect(url, 302);
}

// key 形态(见 photo-snapshot-util / photo-original-util):
//   photo-snapshots/{ownerUserId}/{albumId}/{photoId}/{renderVersion}.{ext}
//   photo-originals/{albumId}/{photoId}.jpg
function albumIdOf(key: string): string | null {
  const parts = key.split('/');
  if (parts[0] === 'photo-snapshots') return parts[2] ?? null;
  if (parts[0] === 'photo-originals') return parts[1] ?? null;
  return null;
}

async function canReadPrivate(req: Request, key: string): Promise<boolean> {
  const albumId = albumIdOf(key);
  if (!albumId) return false;

  // ① 分享链接即能力:token 对应的相册必须就是这组 key 的相册。
  const token = new URL(req.url).searchParams.get('t');
  if (token) {
    const share = await albumShareRepo.findByToken(token);
    if (share && share.albumId === albumId) return true;
  }

  // ② 登录态:owner 或协作者。
  const session = await getAuth().api.getSession({ headers: req.headers });
  const userId = session?.user?.id;
  if (!userId) return false;

  const album = await albumRepo.findById(albumId);
  if (!album) return false;
  if (album.userId === userId) return true;
  return albumMemberRepo.exists(albumId, userId);
}

export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const { key: segments } = await ctx.params;
    const key = segments.map((s) => decodeURIComponent(s)).join('/');

    // `..` 与非法前缀一律拒:代理层绝不能变成任意对象的读取器。
    if (!ALLOWED_KEY.test(key) || key.includes('..')) return notFound();

    if (PUBLIC_PREFIXES.some((p) => key.startsWith(p))) return redirectToObject(key);
    if (await canReadPrivate(req, key)) return redirectToObject(key);
    return new NextResponse('forbidden', { status: 403 });
  } catch (e) {
    logger.error({ err: String(e) }, 'asset proxy failed');
    return notFound();
  }
}
