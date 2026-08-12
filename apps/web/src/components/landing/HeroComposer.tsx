'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signIn } from '@/lib/auth/client';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';
import { IMAGE_INPUT_ACCEPT } from '@/lib/photo/heic';
import { photoStore } from '@/lib/photo/store';
import {
  AnonLimitError,
  clusterCompressedPhotos,
  compressedPhotosFromCache,
  CreditInsufficientError,
  PhotosUnavailableError,
  PhotosUploadFailedError,
  PhotosUploadIncompleteError,
  UnauthorizedError,
  photosFromStore,
  submitAnalyzeV3,
} from '@/lib/generation/client';
import { albumRecipe, generationDraft, type GenerationDraft } from '@/lib/generation/draft';
import type { AppMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

type LocalPhoto = {
  photoId: string;
  previewUrl: string;
  width: number;
  height: number;
  // Holds the compressed photo (incl. transient clusterGeo) so clustering can run
  // over the WHOLE selected set at submit time — clusterId is a property of the set,
  // never of a single file, so it can't be assigned in the per-file onFiles loop.
  compressed?: CompressedPhoto;
};

interface Props {
  locale: Locale;
  placeholder: string;
  uploadLabel: string;
  hints: { label: string; fill: string }[];
  createMessages: AppMessages['dashboard']['create'];
  resumeGeneration?: boolean;
  variant?: 'home1' | 'redesign';
  submitLabel?: string;
}

function inferLanguage(prompt: string): 'zh' | 'en' {
  return /[一-龥]/.test(prompt) ? 'zh' : 'en';
}

// 上传进度气泡的阶段:选图后逐张压缩,或点发送后逐张直传 R2。两段都可数 ——
// 直传把每张照片单发到 R2,50 张在手机上是以分钟计的,不能再让它显示一条不定量的
// 流动条装作在动。total=0 表示还不知道分母,退回流动条。
type UploadStage = { kind: 'compress' | 'upload'; done: number; total: number };

// 上传进度气泡:浮在 composer 上方,显示「正在处理照片 N/M」/「正在上传 N/M」+ 进度条。
function UploadBubble({ stage, t }: { stage: UploadStage | null; t: Props['createMessages'] }) {
  if (!stage) return null;
  const isCompress = stage.kind === 'compress';
  const counted = stage.total > 0;
  const pct = counted ? Math.round((stage.done / stage.total) * 100) : 0;
  const prefix = isCompress ? t.uploadProcessing : t.uploadSending;
  const label = counted ? `${prefix} ${stage.done}/${stage.total}` : prefix;
  return (
    <div
      role="status"
      aria-live="polite"
      className="yj-up-bubble"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(100% + 12px)',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '10px 15px',
        borderRadius: 14,
        background: 'rgba(20,20,22,.92)',
        color: '#fff',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        whiteSpace: 'nowrap',
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 15,
          height: 15,
          flexShrink: 0,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,.32)',
          borderTopColor: '#fff',
          animation: 'yj-up-spin .7s linear infinite',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 128 }}>
        <span>{label}</span>
        <span style={{ position: 'relative', height: 3, borderRadius: 2, background: 'rgba(255,255,255,.22)', overflow: 'hidden' }}>
          {counted ? (
            <span
              style={{
                position: 'absolute',
                insetBlock: 0,
                left: 0,
                width: `${pct}%`,
                borderRadius: 2,
                background: 'linear-gradient(90deg,var(--grad-green,#13b8a6),var(--grad-purple,#8c5ef4))',
                transition: 'width .25s ease',
              }}
            />
          ) : (
            <span
              style={{
                position: 'absolute',
                insetBlock: 0,
                width: '40%',
                borderRadius: 2,
                background: 'linear-gradient(90deg,var(--grad-green,#13b8a6),var(--grad-purple,#8c5ef4))',
                animation: 'yj-up-indet 1.1s ease-in-out infinite',
              }}
            />
          )}
        </span>
      </div>
      <style>{`.yj-up-bubble{box-shadow:0 10px 34px rgba(0,0,0,.24)}@keyframes yj-up-spin{to{transform:rotate(360deg)}}@keyframes yj-up-indet{0%{left:-40%}100%{left:100%}}`}</style>
    </div>
  );
}

export function HeroComposer({
  locale,
  placeholder,
  uploadLabel,
  hints,
  createMessages: t,
  resumeGeneration = false,
  variant = 'home1',
  submitLabel = t.send,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const resumeAttempted = useRef(false);

  const loginResumePath = `/${locale}?resumeGeneration=1`;
  const loginPath = `/${locale}/login?from=${encodeURIComponent(loginResumePath)}`;

  const hasActiveSession = async () => {
    try {
      const { data } = await getSession();
      return !!data?.session;
    } catch {
      return false;
    }
  };

  const saveDraftAndLogin = (draft: GenerationDraft) => {
    generationDraft.save(draft);
    router.push(loginPath);
  };

  // 游客模式:没 session 就静默建匿名影子账号继续创作(登录墙从「发送」后移到
  // 聊天/保存/分享)。建号失败(IP 限流/网络)退回老路:存草稿跳登录。
  // anonymous=true 时跳过照片快照上云(游客零 R2 写入,服务端同样会 403)。
  const ensureSession = async (): Promise<{ ok: boolean; anonymous: boolean }> => {
    try {
      const { data } = await getSession();
      if (data?.session) {
        return {
          ok: true,
          anonymous: Boolean((data.user as { isAnonymous?: boolean | null })?.isAnonymous),
        };
      }
    } catch {
      // fall through to anonymous sign-in
    }
    try {
      const { error } = await signIn.anonymous();
      if (!error) return { ok: true, anonymous: true };
    } catch {
      // fall through
    }
    return { ok: false, anonymous: false };
  };

  const submitDraft = async (
    draft: GenerationDraft,
    cachedPhotos?: readonly CompressedPhoto[],
    opts: { anonymous?: boolean } = {},
  ) => {
    const photoIds = draft.photoIds;
    // No client-side balance pre-check here on purpose: selecting/uploading photos
    // is cheap (compressed, client-side) and is exactly the investment we WANT the
    // user to make before any paywall (sunk-cost — once they've done the work they
    // don't want to abandon). The only billing gate lives server-side, right before
    // the AI runs: submitAnalyzeV3 → precheck + hold inside the album tx, which throws
    // CREDIT_INSUFFICIENT before the agent is ever called (no wasted AI spend). The
    // catch below routes that to /credits.
    // Prefer the in-memory compressed set (cluster it here); else rebuild from
    // IndexedDB (photosFromStore clusters internally). Either way the photos sent
    // carry clusterId only — never coordinates.
    const cached = compressedPhotosFromCache(photoIds, cachedPhotos);
    const builtPhotos = cached ? clusterCompressedPhotos(cached) : await photosFromStore(photoIds);
    const trimmed = draft.prompt.trim();
    // 直传阶段是整条创建里最长的一段(每张照片一个 PUT),把逐张进度接到气泡上;
    // 否则 50 张在手机上就是几分钟对着一条不动的流动条。
    setUploadStage({ kind: 'upload', done: 0, total: builtPhotos.length });
    const { albumId, requestId } = await submitAnalyzeV3(
      {
        requestId: crypto.randomUUID(),
        language: draft.language,
        // promptHint is optional — omit when blank.
        ...(trimmed ? { promptHint: trimmed } : {}),
        photos: builtPhotos,
      },
      {
        skipCloudBackup: opts.anonymous === true,
        onUploadProgress: (done, total) => setUploadStage({ kind: 'upload', done, total }),
      },
    );
    generationDraft.clear();
    albumRecipe.save(albumId, { language: draft.language, photoIds, requestId });
    router.push(`/${locale}/album/${albumId}`);
  };

  useEffect(() => {
    if (!resumeGeneration || resumeAttempted.current) return;
    resumeAttempted.current = true;
    const draft = generationDraft.load();
    if (!draft) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    setValue(draft.prompt);
    (async () => {
      // 首页拼贴预览:display 派生图足够,不解码原图。
      const urls = await photoStore.getTierUrls(draft.photoIds, 'display');
      const restored = draft.photoIds
        .filter((id) => urls[id])
        .map((id) => ({ photoId: id, previewUrl: urls[id]!, width: 0, height: 0 }));
      if (cancelled) return;
      setPhotos(restored);
      if (restored.length < 1) {
        generationDraft.clear();
        setErr(t.errPhotosUnavailable);
        setBusy(false);
        return;
      }
      try {
        const session = await ensureSession();
        if (!session.ok) {
          saveDraftAndLogin(draft);
          return;
        }
        await submitDraft(draft, undefined, { anonymous: session.anonymous });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof CreditInsufficientError) {
          router.push(`/${locale}/credits?from=home`);
          return;
        }
        if (e instanceof UnauthorizedError || e instanceof AnonLimitError) {
          saveDraftAndLogin(draft);
          return;
        }
        if (e instanceof PhotosUnavailableError) {
          generationDraft.clear();
          setErr(t.errPhotosUnavailable);
        } else if (e instanceof PhotosUploadFailedError) {
          // 草稿不清:照片还在 IndexedDB,用户重新点发送就能整批重传。
          setErr(t.errPhotosUploadFailed.replace('{count}', String(e.failedPhotoIds.length)));
        } else if (e instanceof PhotosUploadIncompleteError) {
          setErr(t.errPhotosUploadFailed.replace('{count}', String(e.missingCount)));
        } else {
          setErr(e instanceof Error ? e.message : String(e));
        }
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, resumeGeneration, router, t.errPhotosUnavailable, t.errPhotosUploadFailed]);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    // 只处理还装得下的张数;total 用它做分母,气泡才不会显示 3/50 却卡在上限。
    const room = Math.max(0, MAX_PHOTOS_PER_GENERATION - photos.length);
    const list = Array.from(files).slice(0, room);
    if (list.length === 0) return;
    setBusy(true);
    setErr(null);
    setUploadStage({ kind: 'compress', done: 0, total: list.length });
    const next: LocalPhoto[] = [];
    for (const f of list) {
      const photoId = crypto.randomUUID();
      try {
        // compressFile 内部会把 HEIC/HEIF 转成 JPEG 再解码(见 lib/photo/heic.ts)。
        const compressed = await compressFile(f, photoId);
        try {
          await photoStore.put(photoId, f);
        } catch (storeErr) {
          // 本地原图存不进 IndexedDB(Safari 对 file-backed Blob 的各种边界)不丢照片:
          // 生成用 compressed 就够;重试/高清导出走既有的原图缺失降级。
          console.warn('[photo] original not stored locally', photoId, storeErr);
        }
        next.push({
          photoId,
          // 预览用转换后的 JPEG(compressed.base64),而非原始文件 —— 这样 HEIC/HEIF 也能显示
          // (浏览器 <img> 不认原始 HEIC)。
          previewUrl: compressed.base64,
          width: compressed.width,
          height: compressed.height,
          compressed,
        });
      } catch (e) {
        // 真正无法解码/不支持的文件(含个别坏 HEIC)跳过,不打断整批;留痕便于排查。
        console.warn('[photo] skipped undecodable file', photoId, e);
      }
      // 成功或跳过都推进进度:分母是「打算处理的张数」,进度条一定走满。
      setUploadStage((s) => (s && s.kind === 'compress' ? { ...s, done: s.done + 1 } : s));
    }
    setPhotos((prev) => [...prev, ...next]);
    setUploadStage(null);
    setBusy(false);
  };

  const remove = (photoId: string) =>
    setPhotos((prev) => prev.filter((p) => p.photoId !== photoId));

  const submit = async () => {
    if (busy) return;
    if (photos.length < 1) {
      setErr(t.errPhotoMin);
      return;
    }
    // The story prompt is optional in v2 (promptHint): photos are the only required
    // step. If blank, the authoring flow asks the theme question first.
    setBusy(true);
    setErr(null);
    setUploadStage({ kind: 'upload', done: 0, total: photos.length });
    const language = inferLanguage(value);
    const photoIds = photos.map((p) => p.photoId);
    const draft = { prompt: value.trim(), language, photoIds };
    try {
      const session = await ensureSession();
      if (!session.ok) {
        saveDraftAndLogin(draft);
        return;
      }
      await submitDraft(
        draft,
        photos.map((p) => p.compressed).filter((p): p is CompressedPhoto => !!p),
        { anonymous: session.anonymous },
      );
    } catch (e) {
      setUploadStage(null);
      if (e instanceof CreditInsufficientError) {
        generationDraft.save(draft);
        router.push(`/${locale}/credits?from=home`);
        return;
      }
      if (e instanceof UnauthorizedError || e instanceof AnonLimitError) {
        saveDraftAndLogin(draft);
        return;
      }
      if (e instanceof PhotosUnavailableError) {
        setErr(t.errPhotosUnavailable);
        setBusy(false);
        return;
      }
      // 直传 R2 时有照片没传上去:如实报数,不偷偷少建几张。照片还在内存/IndexedDB,
      // 用户再点一次发送就整批重传 —— 注意是**整批**:每次提交都会重新签一个
      // sessionId,key 是 analyze-uploads/{userId}/{sessionId}/,所以重试不是覆盖写,
      // 上一轮传成功的对象会变成孤儿等生命周期规则回收(见 analyze-upload-util.ts)。
      // 没建成书就没扣积分,重试不会重复计费。
      if (e instanceof PhotosUploadFailedError) {
        setErr(t.errPhotosUploadFailed.replace('{count}', String(e.failedPhotoIds.length)));
        setBusy(false);
        return;
      }
      // 服务端去 R2 取字节时少了几张:文案同上(都是「有 N 张没传上去,重试」),
      // 但错误来源不同 —— 这个是服务端发现的,e.message 是个裸数字,不能直接显示。
      if (e instanceof PhotosUploadIncompleteError) {
        setErr(t.errPhotosUploadFailed.replace('{count}', String(e.missingCount)));
        setBusy(false);
        return;
      }
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (variant === 'redesign') {
    return (
      <>
        <style>{`
          #homepage-composer.landing-composer {
            position: relative; z-index: 1; border-radius: 22px; padding: 16px 16px 14px; text-align: left;
            background: rgba(255,255,255,.58);
            -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid rgba(255,255,255,.70);
            box-shadow: 0 6px 30px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.9);
            transition: box-shadow .3s ease;
          }
          #homepage-composer.landing-composer:focus-within {
            box-shadow: 0 0 0 4px rgba(19,184,166,.18), 0 12px 44px rgba(140,94,244,.16);
          }
          #homepage-composer .cmp-input {
            width: 100%; border: 0; outline: none; resize: none; font-size: 15px; line-height: 1.6;
            color: #111; background: transparent; padding: 6px 4px; font-family: inherit;
          }
          #homepage-composer .cmp-input::placeholder { color: #888; }
          #homepage-composer .cmp-tile {
            display: grid; place-items: center; margin-left: 14px; margin-top: 12px; width: 66px; aspect-ratio: 1 / 1.414;
            flex: none; border-radius: 12px; background: rgba(17,17,17,.05); border: 0; color: #9aa0a8; cursor: pointer;
            transform: rotate(-20deg); transition: background .15s, color .15s, transform .18s cubic-bezier(.34,1.56,.64,1);
          }
          #homepage-composer .cmp-tile:hover { background: rgba(17,17,17,.09); color: #555; }
          #homepage-composer .cmp-tile:active { transform: rotate(0deg) scale(.97); }
          #homepage-composer .btn-glow { position: relative; display: inline-block; }
          #homepage-composer .btn-glow > button { position: relative; z-index: 1; transition: transform .2s ease, opacity .2s ease; }
          #homepage-composer .btn-glow::after {
            content: ''; position: absolute; z-index: 0; pointer-events: none;
            left: 6%; right: 6%; bottom: -3px; height: 72%;
            background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
            filter: blur(14px); opacity: .7; border-radius: 9999px;
            transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
          }
          #homepage-composer .btn-glow:not(.btn-glow-disabled):hover > button { transform: translateY(-2px); }
          #homepage-composer .btn-glow:not(.btn-glow-disabled):hover::after { filter: blur(18px); opacity: .85; bottom: -5px; }
          #homepage-composer .btn-glow-disabled::after { opacity: 0; }
          #homepage-composer .cmp-submit {
            display: inline-flex; align-items: center; gap: 6px; padding: 10px 28px; border-radius: 9999px;
            background: #111; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; border: 0;
          }
        `}</style>
        <div id="homepage-composer" className="landing-composer">
          <UploadBubble stage={uploadStage} t={t} />
          <div className="flex items-start gap-4">
            <label title={uploadLabel} aria-disabled={busy} className="cmp-tile">
              <input
                type="file"
                accept={IMAGE_INPUT_ACCEPT}
                multiple
                className="hidden"
                disabled={busy}
                aria-label={uploadLabel}
                onChange={(e) => onFiles(e.target.files)}
              />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </label>
            <textarea
              rows={4}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={500}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (busy) return;
                  void submit();
                }
              }}
              placeholder={placeholder}
              className="cmp-input flex-1 min-w-0"
            />
          </div>
          {photos.length > 0 && (
            <div className="mt-4">
              <div className="grid grid-cols-6 gap-2 md:grid-cols-8">
                {photos.map((p) => (
                  <div key={p.photoId} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" className="aspect-square w-full rounded-lg object-cover" />
                    <button
                      type="button"
                      aria-label={t.removePhoto}
                      onClick={() => remove(p.photoId)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--meta)]">
                {t.photoCount.replace('{count}', String(photos.length))} · {t.minPhotos}
              </p>
            </div>
          )}
          <div className="flex justify-end" style={{ marginTop: '-22px' }}>
            <div className={`btn-glow ${busy ? 'btn-glow-disabled' : ''}`}>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                aria-label={t.send}
                title={t.send}
                className="cmp-submit disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    <span>{submitLabel}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
          {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        #homepage-composer .btn-glow { position: relative; }
        #homepage-composer .btn-glow > button { position: relative; z-index: 1; }
        #homepage-composer .btn-glow::after {
          content: ''; position: absolute; z-index: 0; pointer-events: none;
          left: 6%; right: 6%; bottom: -3px; height: 72%;
          background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
          filter: blur(13px); opacity: .6; border-radius: 9999px;
          transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
        }
        #homepage-composer .btn-glow:not(.btn-glow-disabled):hover > button { transform: translateY(-2px); }
        #homepage-composer .btn-glow:not(.btn-glow-disabled):hover::after { filter: blur(17px); opacity: .78; bottom: -5px; }
        #homepage-composer .btn-glow-round::after { left: -14%; right: -14%; bottom: -3px; height: 100%; filter: blur(10px); opacity: .6; }
        #homepage-composer .btn-glow-round:not(.btn-glow-disabled):hover > button { transform: translateY(-1px); }
        #homepage-composer .btn-glow-round:not(.btn-glow-disabled):hover::after { filter: blur(13px); opacity: .8; bottom: -4px; }
      `}</style>
      <div
        id="homepage-composer"
        className="relative z-[1] w-full max-w-[720px] rounded-[22px] p-[2px] text-left transition-shadow focus-within:shadow-[0_0_0_4px_rgba(19,184,166,0.18)]"
        style={{
          background: 'linear-gradient(135deg, var(--grad-green), var(--grad-purple) 55%, var(--grad-lime))',
        }}
      >
        <UploadBubble stage={uploadStage} t={t} />
        <div className="rounded-[20px] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <label
              title={uploadLabel}
              aria-disabled={busy}
              className="flex h-[78px] w-[52px] flex-shrink-0 -rotate-[15deg] cursor-pointer items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)] aria-disabled:opacity-50"
            >
              <input
                type="file"
                accept={IMAGE_INPUT_ACCEPT}
                multiple
                className="hidden"
                disabled={busy}
                aria-label={uploadLabel}
                onChange={(e) => onFiles(e.target.files)}
              />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
                <line x1="12" y1="6" x2="12" y2="18" />
                <line x1="6" y1="12" x2="18" y2="12" />
              </svg>
            </label>
            <textarea
              rows={2}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={500}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (busy) return;
                  void submit();
                }
              }}
              placeholder={placeholder}
              className="flex-1 resize-none border-none bg-transparent pt-1 text-[var(--text-base)] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
            />
          </div>
          {photos.length > 0 && (
            <div className="mt-4">
              <div className="grid grid-cols-6 gap-2 md:grid-cols-8">
                {photos.map((p) => (
                  <div key={p.photoId} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.previewUrl}
                      alt=""
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t.removePhoto}
                      onClick={() => remove(p.photoId)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--meta)]">
                {t.photoCount.replace('{count}', String(photos.length))} · {t.minPhotos}
              </p>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {hints.map((hint) => (
                <button
                  key={hint.label}
                  type="button"
                  onClick={() => setValue(hint.fill)}
                  className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--meta)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[var(--border-soft)] hover:text-[var(--fg-2)]"
                >
                  {hint.label}
                </button>
              ))}
            </div>
            <div className={`btn-glow btn-glow-round flex-shrink-0 ${busy ? 'btn-glow-disabled' : ''}`}>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                aria-label={t.send}
                title={t.send}
                className="grid h-10 w-10 place-items-center rounded-full bg-[var(--fg)] text-white transition-transform duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
          <p className="mt-4 text-xs text-[var(--meta)]">{busy ? t.compressing : t.tip}</p>
        </div>
      </div>
    </>
  );
}
