'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import { pick } from '@/lib/i18n/pick';
import type { Locale } from '@/lib/i18n/routing';
import { useAnonymousRedirect } from '@/components/app/useAnonymousRedirect';
import { authHrefWithFrom } from '@/lib/auth/redirect';
import { Brand } from '@/components/app/Brand';
import { ChromeStatusBar } from '@/components/app/ChromeStatusBar';
import { PendingInviteRedeemer } from '@/components/app/PendingInviteRedeemer';
import { Sidebar } from '@/components/app/Sidebar';
import { YujeeState } from '@/components/app/YujeeState';
import { AlbumCoverPreview, type AlbumCoverPage } from '@/components/album/AlbumCoverPreview';
import { RetryFailedButton } from '@/components/album/RetryFailedButton';
import { photoStore } from '@/lib/photo/store';
import { normalizePhotoFilterState, type PhotoFilterState } from '@/lib/photo/filter-state';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';
import { IMAGE_INPUT_ACCEPT } from '@/lib/photo/heic';
import {
  clusterCompressedPhotos,
  submitAnalyzeV3,
  CreditInsufficientError,
  PhotosUnavailableError,
  PhotosUploadFailedError,
  PhotosUploadIncompleteError,
} from '@/lib/generation/client';
import { generationDraft, albumRecipe } from '@/lib/generation/draft';
import {
  COVER_THUMBNAIL_CONTENT_TYPE,
  createCoverThumbnailJpeg,
} from '@/lib/photo/cover-thumbnail';

type Album = {
  id: string;
  title: string;
  status: 'AGENT_RUNNING' | 'EDITING' | 'COMPLETED' | 'FAILED';
  // 协同(collab rework §15.2):我在本书上的角色。editor = 被邀请协作的书,
  // 列表显示「协作」徽标且无删除入口(deleteAlbum 是 owner 治理权)。
  role?: 'owner' | 'editor';
  photoCount: number;
  pageCount: number;
  pdfUrl: string | null;
  coverThumbnailUrl: string | null;
  photoFilter: PhotoFilterState | null;
  createdAt: string;
  coverPage: AlbumCoverPage | null;
  // 协作(collab rework §15.2):共享书卡片在 editor 浏览器里没有本地原图,
  // 封面渲染靠 getDetail 的 photoSnapshotUrls(编辑页回退)。列表端点不投影
  // 快照 URL(4s 轮询下塞全量 URL 会让 payload 爆炸,且公开 URL 常态化下发
  // 给 editor 无法在踢人后撤销 —— 审查十三轮指认)。
  // 无封面页时的兜底:项目里的照片 id(草稿排版页图槽优先,其次章节原图),
  // 本机 photoStore 能解出哪张就用哪张当封面缩略图。
  fallbackPhotoIds?: string[];
};

// Single quiet fallback used before a browser-derived cover thumbnail exists.
const DEFAULT_COVER_TINT = 'linear-gradient(135deg,#e7eee9,#d7dedf)';

// How often to re-poll the list while a card is still generating, so a finished
// or swept album flips to its editing/failed skin without a manual refresh.
const POLL_MS = 4000;
const POSTER_CARD_CLASS =
  'album-poster-card group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[18px] bg-[var(--surface)] shadow-[var(--elev-card)] transition duration-300 hover:-translate-y-1 hover:shadow-[var(--elev-card-hover)]';

function coverThumbnailStateKey(album: Album, candidatePhotoIds: string[]): string {
  return JSON.stringify({
    photoFilter: normalizePhotoFilterState(album.photoFilter),
    coverPage: album.coverPage,
    candidatePhotoIds,
  });
}

export default function MyAlbumsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  // 游客(匿名影子账号)不进账号页:带回跳丢去登录(middleware 只看 cookie 存在性,拦不住)。
  useAnonymousRedirect(locale, `/${locale}/my-albums`);
  const t = getMessages(locale).dashboard;

  const router = useRouter();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errKind, setErrKind] = useState<'network' | 'other' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const coverThumbnailAttemptsRef = useRef<Set<string>>(new Set());
  const coverThumbnailTasksRef = useRef<Map<string, Promise<void>>>(new Map());
  const albumsRef = useRef<Album[] | null>(null);
  albumsRef.current = albums;
  const mountedRef = useRef(true);

  const load = async () => {
    setErr(null);
    setErrKind(null);
    try {
      const res = await fetch('/api/v1/albums');
      const json = await res.json();
      if (!json.ok) {
        // 未登录不是「出错了」,是「还没登录」。middleware 的 hasSessionCookie 只看
        // cookie 在不在(edge 上验不了会话),残留/过期的 token 会把人放进这一页,再
        // 被列表接口 401 —— 那时候只有这里知道真相。跳登录用 middleware 同一套
        // from 约定,登完回到这一页;replace 是为了别让返回键把人弹回这个死胡同。
        if (json.error?.code === 'UNAUTHORIZED') {
          router.replace(authHrefWithFrom(`/${locale}/login`, `/${locale}/my-albums`));
          return; // albums 保持 null → 停在 loading 态,不闪一下错误再跳走
        }
        setErr(json.error?.message ?? t.common.error);
        setErrKind('other');
        setAlbums([]);
        return;
      }
      setAlbums((json.data as Album[]).map((item) => ({
        ...item,
        photoFilter: normalizePhotoFilterState(item.photoFilter),
      })));
    } catch {
      setErr(pick(locale, { zh: '网络异常，检查网络', en: 'Network error. Check your connection.' }));
      setErrKind('network');
      setAlbums([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the list fresh only while something is mid-generation. The list
  // endpoint already sweeps zombie jobs (album-service.listByUser), so a quiet
  // re-fetch is enough to surface completion or failure on its own.
  // 协作(collab rework §15.2):owner 的 RUNNING 书才驱动轮询;共享书(editor)
  // 的 RUNNING **不驱动轮询** —— 僵尸共享书不在 editor 侧形成永不终止的循环
  // (editor 侧无 sweep 权,账务清扫只发生在 owner 自己的列表请求里)。owner
  // 侧轮询节奏不变:每拍先刷新,超 15 分钟降频 60s(慢轮询仍然刷新只是低频,
  // 不停止 —— owner 侧列表请求自带僵尸 sweep,会一直收敛到 FAILED/COMPLETED)。
  const POLL_MAX_MS = 15 * 60 * 1000;
  const POLL_SLOW_MS = 60 * 1000;
  const anyRunning = (albums ?? []).some(
    (a) => a.status === 'AGENT_RUNNING' && a.role !== 'editor',
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  const pollStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!anyRunning) {
      pollStartedAtRef.current = null;
      return;
    }
    if (pollStartedAtRef.current === null) pollStartedAtRef.current = Date.now();
    const startedAt = pollStartedAtRef.current;
    const tick = () => {
      loadRef.current();
      const slow = Date.now() - startedAt > POLL_MAX_MS;
      timer = setTimeout(tick, slow ? POLL_SLOW_MS : POLL_MS);
    };
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(tick, POLL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [anyRunning]);

  useEffect(() => {
    if (!albums) return;

    const isCurrentCoverThumbnailState = (albumId: string, coverStateKey: string) => {
      const current = albumsRef.current?.find((item) => item.id === albumId);
      if (!current || current.coverThumbnailUrl) return false;
      const currentCandidatePhotoIds = current.coverPage
        ? Object.values(current.coverPage.imagesJson ?? {}).filter(Boolean)
        : (current.fallbackPhotoIds ?? []);
      return coverThumbnailStateKey(current, currentCandidatePhotoIds) === coverStateKey;
    };

    for (const album of albums) {
      if (album.coverThumbnailUrl) continue;
      // 协作(collab rework §15.2):共享书(role=editor)不生成封面缩略图 ——
      // signCoverThumbnailUpload 是 owner-only,editor 发起注定 403 且会反复重试。
      // editor 打开书时画布走正常渲染;缩略图由 owner 打开列表时生成。
      if (album.role === 'editor') continue;
      // 有封面页用封面页图槽;没有(未定稿的草稿相册)用项目里的照片兜底,
      // 卡片不再停在空报刊占位上。
      const candidatePhotoIds = album.coverPage
        ? Object.values(album.coverPage.imagesJson ?? {}).filter(Boolean)
        : (album.fallbackPhotoIds ?? []);
      if (candidatePhotoIds.length === 0) continue;
      const coverStateKey = coverThumbnailStateKey(album, candidatePhotoIds);
      const attemptKey = `${album.id}:${coverStateKey}`;
      if (coverThumbnailAttemptsRef.current.has(attemptKey)) continue;
      coverThumbnailAttemptsRef.current.add(attemptKey);
      const photoFilter = normalizePhotoFilterState(album.photoFilter);
      const previousTask = coverThumbnailTasksRef.current.get(album.id) ?? Promise.resolve();

      const task = previousTask.catch(() => undefined).then(async () => {
        if (!isCurrentCoverThumbnailState(album.id, coverStateKey)) return;
        for (const photoId of candidatePhotoIds) {
          const { blob: displayBlob, filteredFallback } = await photoStore.getTierBlobStatus(
            photoId,
            'display',
            photoFilter,
          );
          if (!displayBlob) continue;
          if (filteredFallback) {
            // A positive LUT failed and display intentionally fell back to base pixels.
            // Keep the live preview fallback, but never persist it as this album's filter.
            console.warn('Cover thumbnail skipped: filtered display render unavailable', {
              albumId: album.id,
              photoId,
            });
            continue;
          }
          if (!isCurrentCoverThumbnailState(album.id, coverStateKey)) return;

          const thumbnail = await createCoverThumbnailJpeg(displayBlob);
          if (!isCurrentCoverThumbnailState(album.id, coverStateKey)) return;
          const signRes = await fetch(`/api/v1/albums/${album.id}/cover-thumbnail-upload-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contentType: COVER_THUMBNAIL_CONTENT_TYPE,
              size: thumbnail.size,
            }),
          });
          const signJson = await signRes.json();
          if (!signRes.ok || signJson.ok !== true) {
            throw new Error(signJson.error?.message ?? 'cover thumbnail sign failed');
          }

          const { putUrl, r2Key, coverRevision } = signJson.data;
          if (!isCurrentCoverThumbnailState(album.id, coverStateKey)) return;
          const putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'Content-Type': COVER_THUMBNAIL_CONTENT_TYPE },
            body: thumbnail,
          });
          if (!putRes.ok) throw new Error(`cover thumbnail R2 PUT ${putRes.status}`);

          if (!isCurrentCoverThumbnailState(album.id, coverStateKey)) return;
          const confirmRes = await fetch(`/api/v1/albums/${album.id}/cover-thumbnail`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ r2Key, coverRevision }),
          });
          const confirmJson = await confirmRes.json();
          if (!confirmRes.ok || confirmJson.ok !== true) {
            throw new Error(confirmJson.error?.message ?? 'cover thumbnail confirm failed');
          }

          const coverThumbnailUrl = confirmJson.data?.coverThumbnailUrl;
          if (!coverThumbnailUrl || !mountedRef.current || !isCurrentCoverThumbnailState(album.id, coverStateKey)) return;
          setAlbums((prev) =>
            prev?.map((item) =>
              item.id === album.id ? { ...item, coverThumbnailUrl } : item,
            ) ?? prev,
          );
          return;
        }
      });
      coverThumbnailTasksRef.current.set(album.id, task);
      void task.finally(() => {
        if (coverThumbnailTasksRef.current.get(album.id) === task) {
          coverThumbnailTasksRef.current.delete(album.id);
        }
      }).catch((e) => {
        coverThumbnailAttemptsRef.current.delete(attemptKey);
        console.error('Cover thumbnail upload failed', e);
      });
    }
  }, [albums]);

  const remove = async (id: string) => {
    if (!window.confirm(t.myAlbums.confirmDelete)) return;
    setDeleting(id);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/albums/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setAlbums((prev) => (prev ?? []).filter((a) => a.id !== id));
      } else {
        setErr(json.error?.message ?? t.common.error);
        setErrKind('other');
      }
    } catch {
      setErr(pick(locale, { zh: '网络异常，检查网络', en: 'Network error. Check your connection.' }));
      setErrKind('network');
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const albumCount = albums?.length ?? 0;
  const runningCount = (albums ?? []).filter((a) => a.status === 'AGENT_RUNNING').length;
  const albumSummary =
    pick(locale, { zh: `共 ${albumCount} 本 · ${runningCount} 本正在生成`, en: `${albumCount} album${albumCount === 1 ? '' : 's'} · ${runningCount} generating` });

  const pageUnit = (count: number) =>
    pick(locale, { zh: `${count} 页`, en: `${count} page${count === 1 ? '' : 's'}` });

  const cardKicker = (a: Album) =>
    pick(locale, { zh: `${a.photoCount} 张照片`, en: `${a.photoCount} photo${a.photoCount === 1 ? '' : 's'}` });

  const albumFoot = (a: Album) => {
    const date = formatDate(a.createdAt);
    const pages = pageUnit(a.pageCount);
    return date ? `${date} · ${pages}` : pages;
  };

  const statusTone = (status: Album['status']) => {
    if (status === 'FAILED') return { chip: 'bg-[rgba(224,60,60,0.10)] text-[#c0392b]', dot: '#e03c3c' };
    if (status === 'AGENT_RUNNING') return { chip: 'bg-black/[0.05] text-[#555]', dot: '#8C5EF4' };
    return { chip: 'bg-[rgba(19,184,166,0.12)] text-[var(--accent-active)]', dot: 'var(--grad-green)' };
  };

  const statusChip = (status: Album['status']) => {
    const tone = statusTone(status);
    const isRunning = status === 'AGENT_RUNNING';
    return (
      <span className={`album-status-chip inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone.chip}`}>
        <span
          className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'animate-[cover-sweep_1.2s_linear_infinite]' : ''}`}
          style={{ background: tone.dot }}
        />
        {t.myAlbums.status[status]}
      </span>
    );
  };

  // 协作徽标(collab rework §15.2):role=editor 的共享书。点开即编辑,
  // 但无删除入口(治理权)。
  const roleBadge = (a: Album) =>
    a.role === 'editor' ? (
      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[rgba(140,94,244,0.12)] px-2 py-0.5 text-[10.5px] font-semibold text-[#8C5EF4]">
        {t.myAlbums.collab}
      </span>
    ) : null;

  const cardTags = (a: Album) => (
    <span className="flex shrink-0 items-center gap-1.5">
      {roleBadge(a)}
      {statusChip(a.status)}
    </span>
  );

  // Hover-revealed delete control. Rendered as a card-level sibling that sits
  // above the cover link (never a <button> nested in an <a>), so clicking it
  // deletes without also opening the album and the markup stays valid.
  // 仅 owner 渲染(collab rework:deleteAlbum 是治理权,editor 的共享书不可删;
  // 后端 DELETE 也按 Creator/治理 seam 兜底 403)。
  const deleteButton = (a: Album) =>
    a.role === 'editor' ? null : (
    <div className="absolute right-2 top-2 z-[5] flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        title={t.myAlbums.delete}
        aria-label={t.myAlbums.delete}
        disabled={deleting === a.id}
        onClick={() => remove(a.id)}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/85 text-[var(--fg-2)] shadow-[0_1px_4px_rgba(0,0,0,0.08)] backdrop-blur transition-colors hover:bg-white disabled:opacity-40"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );

  const coverDecor = () => (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: DEFAULT_COVER_TINT }}
    >
      <div className="relative h-[62%] w-[58%] rounded-[10px] bg-white/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]">
        <span className="absolute left-[16%] top-[22%] h-[7px] w-[58%] rounded bg-black/10" />
        <span className="absolute left-[16%] top-[38%] h-[5px] w-[68%] rounded bg-black/[0.07]" />
        <span className="absolute bottom-[18%] left-[16%] h-[5px] w-[44%] rounded bg-black/[0.08]" />
      </div>
    </div>
  );

  const card = (a: Album) => {
    if (a.status === 'AGENT_RUNNING') {
      return (
        <div
          key={a.id}
          className={`${POSTER_CARD_CLASS} cover-running`}
        >
          <Link href={`/${locale}/album/${a.id}`} className="block text-inherit no-underline">
            <div className="cover-loading relative grid aspect-[3/4] place-items-center overflow-hidden bg-[#f4f4f4] px-4">
              <YujeeState
                variant="loading"
                compact
                showDots
                title="Loading"
              />
            </div>
          </Link>
          <div className="flex min-h-[52px] items-center justify-between gap-2 px-3.5 py-3">
            <span className="min-w-0 truncate text-[12.5px] text-[var(--muted)]">
              {pick(locale, { zh: '正在排版 · 约 1 分钟', en: 'Laying out · about 1 min' })}
            </span>
            {cardTags(a)}
          </div>
        </div>
      );
    }

    if (a.status === 'FAILED') {
      return (
        <div
          key={a.id}
          className={POSTER_CARD_CLASS}
        >
          {deleteButton(a)}
          <div className="cover-fail relative grid aspect-[3/4] place-items-center overflow-hidden bg-[#2a2a2e] px-5 text-center">
            <div>
              <svg
                className="mx-auto h-[34px] w-[34px] text-white/90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="mt-3 text-sm text-white/90">{t.myAlbums.failedLabel}</div>
              {/* 重试会重新扣费/挂 hold(账务在 owner 名下),retry API 是 owner-only;
                  共享书(role=editor)不渲染死按钮,重试由 owner 完成。 */}
              {a.role !== 'editor' && <RetryFailedButton albumId={a.id} variant="card" />}
            </div>
          </div>
          <div className="flex min-h-[52px] items-center justify-between gap-2 px-3.5 py-3">
            <span className="min-w-0 truncate text-[12.5px] text-[var(--muted)]">
              {a.title} · {formatDate(a.createdAt)}
            </span>
            {cardTags(a)}
          </div>
        </div>
      );
    }

    // COMPLETED / EDITING — the whole card opens the album.
    return (
      <div
        key={a.id}
        className={POSTER_CARD_CLASS}
      >
        {deleteButton(a)}
        <Link href={`/${locale}/album/${a.id}`} className="block text-inherit no-underline">
          <div className="relative aspect-[3/4] overflow-hidden bg-[var(--bg)]">
            <AlbumCoverPreview
              coverPage={a.coverPage}
              coverThumbnailUrl={a.coverThumbnailUrl}
              photoFilter={a.photoFilter}
              pageCount={a.pageCount}
              fallback={coverDecor()}
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_0%,transparent_34%,transparent_52%,rgba(10,8,20,0.62)_100%)]" />
            <span className="cover-kicker absolute left-4 top-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]">
              {cardKicker(a)}
            </span>
            <div className="cover-title absolute bottom-4 left-[18px] right-[18px] font-['Playfair_Display','Noto_Serif_SC_Landing',Georgia,serif] text-[22px] font-bold leading-[1.14] text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.45)] sm:text-2xl">
              {a.title}
            </div>
          </div>
        </Link>
        <div className="flex min-h-[52px] items-center justify-between gap-2 px-3.5 py-3">
          <span className="min-w-0 truncate text-[12.5px] text-[var(--muted)]">
            {albumFoot(a)}
          </span>
          {cardTags(a)}
        </div>
      </div>
    );
  };

  // New-album entry: pick photos directly, then create the album and jump straight
  // to the authoring page, which shows the loading placeholder while the AI runs.
  // The theme is asked there in the chat — nothing to type up front. Originals live
  // in IndexedDB (invariant 1); base64 is rebuilt at submit. The balance gate runs
  // on the click (before any upload); 0 books stashes a draft and routes to top up,
  // resuming on the home composer.
  const startNewAlbum = async (files: FileList | null) => {
    if (!files || files.length === 0 || creating) return;
    setCreating(true);
    setErr(null);
    const language: 'zh' | 'en' = locale === 'zh' ? 'zh' : 'en';
    const photoIds: string[] = [];
    const compressed: CompressedPhoto[] = [];
    try {
      for (const f of Array.from(files).slice(0, 30)) {
        const photoId = crypto.randomUUID();
        try {
          // compressFile 内部把 HEIC/HEIF 转成 JPEG 再解码(见 lib/photo/heic.ts)。
          const c = await compressFile(f, photoId);
          try {
            await photoStore.put(photoId, f);
          } catch (storeErr) {
            // 本地原图存不进 IndexedDB(Safari 对 file-backed Blob 的各种边界)不丢照片:
            // 生成用 compressed 就够;重试/高清导出走既有的原图缺失降级。
            console.warn('[photo] original not stored locally', photoId, storeErr);
          }
          compressed.push(c);
          photoIds.push(photoId);
        } catch (e) {
          // 真正无法解码/不支持的文件(含个别坏 HEIC)跳过,不打断整批;留痕便于排查。
          console.warn('[photo] skipped undecodable file', photoId, e);
        }
      }
      // 选中的全是不支持的格式 → 没有可用照片。静默退出,不建册、不报错。
      if (compressed.length === 0) {
        setCreating(false);
        return;
      }
      // Cluster the whole set + drop transient geo → photos carry clusterId only.
      const builtPhotos = clusterCompressedPhotos(compressed);
      // No client-side balance pre-check: uploading photos is cheap and is the
      // investment we want before any paywall. The billing gate is server-side,
      // right before the AI runs — submitAnalyzeV3 throws CREDIT_INSUFFICIENT (caught
      // below) before the agent is called.
      const { albumId, requestId } = await submitAnalyzeV3({
        requestId: crypto.randomUUID(),
        language,
        photos: builtPhotos,
      });
      albumRecipe.save(albumId, { language, photoIds, requestId });
      router.push(`/${locale}/album/${albumId}`);
    } catch (e) {
      if (e instanceof CreditInsufficientError) {
        generationDraft.save({ prompt: '', language, photoIds });
        router.push(`/${locale}/credits?from=home`);
        return;
      }
      // 直传 R2 有照片没传上去:如实报数(而不是把 Error.message 的英文原文甩出来)。
      setErr(
        e instanceof PhotosUnavailableError
          ? t.create.errPhotosUnavailable
          : e instanceof PhotosUploadFailedError
            ? t.create.errPhotosUploadFailed.replace('{count}', String(e.failedPhotoIds.length))
            : e instanceof PhotosUploadIncompleteError
            ? t.create.errPhotosUploadFailed.replace('{count}', String(e.missingCount))
            : e instanceof Error
              ? e.message
              : t.common.error,
      );
      setErrKind('other');
      setCreating(false);
    }
  };

  // Grid-first "+" entry. Clicking opens the OS photo picker directly; selecting
  // photos starts the album and navigates away. Sized h-full to match the album
  // cards beside it in the supplied gallery shell.
  const newCard = (
    <label
      key="__new__"
      title={t.myAlbums.create}
      aria-label={t.myAlbums.create}
      aria-busy={creating}
      className={`new-album-tile album-poster-card group relative flex h-full min-h-full self-stretch cursor-pointer flex-col place-items-center overflow-hidden rounded-[18px] bg-[var(--surface)] text-[#bbb] shadow-[var(--elev-card)] transition duration-300 after:absolute after:inset-0 after:rounded-[18px] after:border-2 after:border-dashed after:border-[#dcdcdc] after:content-[''] hover:-translate-y-1 hover:text-[var(--accent-active)] hover:shadow-[var(--elev-card-hover)] hover:after:border-[var(--grad-green)] ${creating ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="file"
        accept={IMAGE_INPUT_ACCEPT}
        multiple
        className="hidden"
        disabled={creating}
        onChange={(e) => {
          void startNewAlbum(e.target.files);
          e.target.value = '';
        }}
      />
      <span className="relative z-10 grid flex-1 place-items-center text-center">
        {creating ? (
          <YujeeState variant="loading" compact showDots title="Loading" />
        ) : (
          <span>
            <svg
              className="mx-auto h-[34px] w-[34px] transition-transform group-hover:scale-110"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <line x1="12" y1="5" x2="12" y2="19" />
            </svg>
            <span className="mt-3 block text-sm font-medium">{t.myAlbums.create}</span>
          </span>
        )}
      </span>
    </label>
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--bg)] text-[var(--fg)]">
      <PendingInviteRedeemer locale={locale} />
      <div
        className="page-glow"
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: '-160px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '900px',
          height: '420px',
          zIndex: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(50% 60% at 25% 40%, rgba(19,184,166,.16), transparent 60%), radial-gradient(50% 60% at 75% 40%, rgba(140,94,244,.16), transparent 60%), radial-gradient(60% 50% at 50% 90%, rgba(218,244,94,.14), transparent 60%)',
          filter: 'blur(30px)',
          opacity: 0.7,
        }}
      />
      <Sidebar locale={locale} activeNav="projects" />
      <header className="nav-shell fixed left-0 right-0 top-0 z-50 border-b border-black/[0.04] bg-[rgba(245,245,245,0.78)] backdrop-blur-[18px]">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-5 md:px-8">
          <Brand href={`/${locale}`} markSize={24} />
          <ChromeStatusBar locale={locale} />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1320px] px-5 pb-24 pt-[120px] md:px-8">
        <div className="mb-8 flex items-end justify-between gap-6 md:mb-10">
          <div>
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--meta)]">
              {pick(locale, { zh: '我的作品', en: 'My work' })}
            </div>
            <h1 className="font-['Playfair_Display','Noto_Serif_SC_Landing',Georgia,serif] font-extrabold leading-[1.02] text-[var(--fg)] text-[clamp(36px,6vw,60px)]">
              {t.myAlbums.title}
            </h1>
            <p className="mt-3 text-[15px] text-[var(--muted)]">{albumSummary}</p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium text-[var(--fg-2)] transition hover:bg-black/[0.05]"
              aria-label={pick(locale, { zh: '最近修改', en: 'Recently modified' })}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M6 12h12M10 18h4" />
              </svg>
              {pick(locale, { zh: '最近修改', en: 'Recent' })}
            </button>
          </div>
        </div>

        {creating && (
          <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(245,245,245,0.76)] backdrop-blur-[12px]">
            <YujeeState
              variant="loading"
              title="Loading"
              showDots
            />
          </div>
        )}

        {err && (albums?.length ?? 0) > 0 && <p className="mb-6 text-sm text-red-600">{err}</p>}

        {albums === null && (
          <div className="min-h-[420px]">
            <YujeeState
              variant="loading"
              title="Loading"
              showDots
            />
          </div>
        )}

        {albums !== null && err && albums.length === 0 && (
          <div className="min-h-[420px]">
            <YujeeState
              variant="error"
              title={pick(locale, { zh: '出错了', en: 'Something went wrong' })}
              message={errKind === 'network' ? (pick(locale, { zh: '网络异常，检查网络', en: 'Network error. Check your connection.' })) : err}
            />
          </div>
        )}

        {albums !== null && !err && albums.length === 0 && (
          <div className="min-h-[420px]">
            <YujeeState
              variant="empty"
              title={pick(locale, { zh: '还没有相册', en: 'No albums yet' })}
              message={pick(locale, { zh: '上传照片，开始创建一本新的回忆相册。', en: 'Upload photos to start a new memoir.' })}
            >
              <label className={`inline-flex cursor-pointer items-center justify-center rounded-full bg-[var(--fg)] px-8 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(0,0,0,0.18)] transition hover:-translate-y-0.5 hover:bg-black ${creating ? 'pointer-events-none opacity-60' : ''}`}>
                <input
                  type="file"
                  accept={IMAGE_INPUT_ACCEPT}
                  multiple
                  className="hidden"
                  disabled={creating}
                  onChange={(e) => {
                    void startNewAlbum(e.target.files);
                    e.target.value = '';
                  }}
                />
                {pick(locale, { zh: '新建', en: 'New' })}
              </label>
            </YujeeState>
          </div>
        )}

        {albums !== null && !err && albums.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 sm:gap-x-7 sm:gap-y-9 lg:grid-cols-4 xl:grid-cols-5">
            {newCard}
            {albums.map((a) => card(a))}
          </div>
        )}
      </main>
    </div>
  );
}
