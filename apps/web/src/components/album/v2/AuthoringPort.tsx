'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/app/Brand';
import { photoStore } from '@/lib/photo/store';
import { CreditInsufficientError, UnauthorizedError } from '@/lib/generation/client';
import {
  fetchDraftSkeleton,
  postTheme,
  postChapterChat,
  postFinalize,
  type DraftSkeleton,
  type DraftSkeletonChapter,
  type ChapterState,
} from '@/lib/album/authoring-client';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { PagePreview } from '../PagePreview';
import type { ResolveImage } from '../adapt-layout';

// ════════════════════════════════════════════════════════════════════════════
// AuthoringPort — the v2 "authoring flow" (W10 #140). Shown for an album in the
// DRAFT phase (EDITING with draft_json but no layout_json). It renders the
// read-only skeleton (PagePreview, originals resolved from IndexedDB) beside a
// jellyfish chat rail that drives the product moments from requirements §10:
//   draft-ready → theme → chapter-by-chapter → "finish the whole book".
//
// The authoring tree never crosses to the browser for editing (invariant 12):
// every step posts a free-text nudge / chapterId to a v2 endpoint that re-slices
// draft_json server-side, then we re-fetch the read-only skeleton to repaint.
// ════════════════════════════════════════════════════════════════════════════

type Msg = { role: 'user' | 'assistant'; content: string };
type Stage = 'theme' | 'chapter';

// requirements §5: a chapter auto-advances after ASK_LIMIT turns. Mirrors the
// contract's askCount>=2 rule (V2Chapter.askCount); kept here so the per-chapter
// progress copy ("n/2") stays in one place if the threshold ever moves.
const ASK_LIMIT = 2;
// The v2 endpoints cap free-text at 500 chars (theme/chapter-chat body schemas).
// Match it client-side so an over-long message is truncated, not bounced with a
// raw VALIDATION_FAILED string into the chat.
const MESSAGE_MAX = 500;

const COPY = {
  zh: {
    back: '返回我的项目',
    aiAvatar: '己',
    aiName: '遇己',
    subtitle: '和我聊聊这段回忆',
    statusDraft: '草稿就绪',
    statusFinishing: '完成中',
    draftReady: '草稿已就绪 — 继续讲故事,或直接完成。先帮这本册子定个主题吧:它讲的是谁、什么场合?',
    themeStage: '主题',
    chapterStage: '逐章',
    enterChapters: '开始逐章讲述',
    prevChapter: '上一章',
    nextChapter: '下一章',
    skipChapter: '跳过本章',
    finishAll: '直接完成全书',
    finishHint: '没聊到的章节,会只用照片里看得到的氛围来配文,不编造具体的人事地。',
    finishing: '正在生成你的纪念册…',
    inputThemePlaceholder: '一句话说说这本册子的主题…',
    inputChapterPlaceholder: '聊聊这一章发生了什么…',
    send: '发送',
    thinking: '遇己正在思考…',
    askProgress: (n: number) => `已聊 ${n}/${ASK_LIMIT} 轮`,
    chapterOf: (i: number, total: number) => `第 ${i} / ${total} 章`,
    states: {
      empty: '待讲述',
      asking: '追问中',
      brief_ready: '已记录',
      generated: '已配文',
      skipped: '已跳过',
      finalized: '已定稿',
    } as Record<ChapterState, string>,
    loadError: '草稿加载失败,刷新重试。',
    noDraft: '这本册子还没有草稿,或已经完成。',
    creditShort: '积分不足,正在带你去充值…',
  },
  en: {
    back: 'Back to my projects',
    aiAvatar: 'Y',
    aiName: 'Yujee',
    subtitle: 'Tell me about this memory',
    statusDraft: 'Draft ready',
    statusFinishing: 'Finishing',
    draftReady:
      "Your draft is ready — keep telling the story, or finish now. Let's set a theme first: who is this book about, and what's the occasion?",
    themeStage: 'Theme',
    chapterStage: 'Chapters',
    enterChapters: 'Start chapter by chapter',
    prevChapter: 'Previous',
    nextChapter: 'Next',
    skipChapter: 'Skip this chapter',
    finishAll: 'Finish the whole book',
    finishHint:
      'Chapters you skip get captions written only from what the photos show — no invented names, places, or events.',
    finishing: 'Creating your memoir…',
    inputThemePlaceholder: 'Describe this book in a sentence…',
    inputChapterPlaceholder: 'Tell me what happened in this chapter…',
    send: 'Send',
    thinking: 'Yujee is thinking…',
    askProgress: (n: number) => `${n}/${ASK_LIMIT} turns`,
    chapterOf: (i: number, total: number) => `Chapter ${i} / ${total}`,
    states: {
      empty: 'To tell',
      asking: 'Asking',
      brief_ready: 'Noted',
      generated: 'Written',
      skipped: 'Skipped',
      finalized: 'Final',
    } as Record<ChapterState, string>,
    loadError: 'Failed to load the draft. Refresh to retry.',
    noDraft: 'This book has no draft yet, or it is already finished.',
    creditShort: 'Not enough credits — taking you to top up…',
  },
} as const;

export function AuthoringPort({ albumId, locale }: { albumId: string; locale: Locale }) {
  const t = COPY[locale === 'zh' ? 'zh' : 'en'];
  const [skeleton, setSkeleton] = useState<DraftSkeleton | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'gone'>('loading');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>('theme');
  const [chapterIdx, setChapterIdx] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resolve every photoId referenced by the skeleton to a browser object URL from
  // IndexedDB (invariant 1 — originals never left the device). Missing ids (cache
  // cleared / other device) simply render as empty slots.
  const loadImages = useCallback(async (sk: DraftSkeleton) => {
    const ids = new Set<string>();
    for (const p of sk.pages) for (const id of Object.values(p.imagesJson)) if (id) ids.add(id);
    const urls = await photoStore.getObjectUrls([...ids]);
    setImageUrls(urls);
  }, []);

  const refetch = useCallback(async () => {
    const { draft } = await fetchDraftSkeleton(albumId);
    if (!draft) {
      setLoadState('gone');
      return null;
    }
    setSkeleton(draft);
    void loadImages(draft);
    return draft;
  }, [albumId, loadImages]);

  // First load: pull the skeleton, seed the chat with the draft-ready greeting.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { draft } = await fetchDraftSkeleton(albumId);
        if (cancelled) return;
        if (!draft) {
          setLoadState('gone');
          return;
        }
        setSkeleton(draft);
        void loadImages(draft);
        setMessages([{ role: 'assistant', content: t.draftReady }]);
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [albumId, loadImages, t.draftReady]);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const chapters = skeleton?.chapters ?? [];
  const currentChapter: DraftSkeletonChapter | undefined = chapters[chapterIdx];

  const resolveImage: ResolveImage = useCallback((id) => imageUrls[id], [imageUrls]);

  // Pages grouped for the preview: the current chapter's slice is highlighted.
  const totalPages = skeleton?.pages.length ?? 0;

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !skeleton) return;
    setBusy(true);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      if (stage === 'theme') {
        const { assistantReply } = await postTheme(albumId, text);
        setMessages((m) => [...m, { role: 'assistant', content: assistantReply }]);
        await refetch();
      } else if (currentChapter) {
        const { assistantReply } = await postChapterChat(albumId, currentChapter.chapterId, text);
        setMessages((m) => [...m, { role: 'assistant', content: assistantReply }]);
        await refetch();
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        window.location.assign(localizePath(`/login?from=/album/${albumId}`, locale));
        return;
      }
      if (e instanceof CreditInsufficientError) {
        setMessages((m) => [...m, { role: 'assistant', content: t.creditShort }]);
        window.setTimeout(() => window.location.assign(localizePath('/credits?from=authoring', locale)), 900);
        return;
      }
      setMessages((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }, [albumId, busy, currentChapter, input, locale, refetch, skeleton, stage, t.creditShort]);

  const enterChapters = useCallback(() => {
    setStage('chapter');
    setChapterIdx(0);
  }, []);

  const finalize = useCallback(async () => {
    if (busy || finishing) return;
    setFinishing(true);
    try {
      await postFinalize(albumId);
      // The album is now AGENT_RUNNING ("completing"). A full reload hands control
      // back to the album page's poll, which renders the generating shell and then
      // the editor once layout_json lands. Simplest correct path; the poll loop
      // here has already settled, so reload rather than try to restart it.
      window.location.reload();
    } catch (e) {
      setFinishing(false);
      if (e instanceof UnauthorizedError) {
        window.location.assign(localizePath(`/login?from=/album/${albumId}`, locale));
        return;
      }
      if (e instanceof CreditInsufficientError) {
        window.location.assign(localizePath('/credits?from=authoring', locale));
        return;
      }
      setMessages((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : String(e) }]);
    }
  }, [albumId, busy, finishing, locale]);

  const statusLabel = finishing ? t.statusFinishing : t.statusDraft;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]">
      {/* ── Header (mirrors AlbumGeneratingShell / editor) ── */}
      <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--surface)] px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href={localizePath('/my-albums', locale)}
            title={t.back}
            aria-label={t.back}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <Brand href={localizePath('/', locale)} />
          <span className="text-[var(--meta)] text-[var(--text-sm)]">/</span>
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--bg)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--muted)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--grad-lime)]" />
            <span>{statusLabel}</span>
          </span>
        </div>
        <div className="hidden items-center gap-2 text-[var(--text-xs)] text-[var(--muted)] sm:flex">
          <span>{stage === 'theme' ? t.themeStage : t.chapterStage}</span>
          {stage === 'chapter' && chapters.length > 0 && (
            <span className="font-mono tabular-nums">{t.chapterOf(chapterIdx + 1, chapters.length)}</span>
          )}
        </div>
      </header>

      <div className="relative grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        {/* ── Left: skeleton preview ── */}
        <main className="relative overflow-auto bg-[var(--bg)] p-8">
          {loadState === 'error' ? (
            <Centered>{t.loadError}</Centered>
          ) : loadState === 'gone' ? (
            <Centered>{t.noDraft}</Centered>
          ) : !skeleton ? (
            <Centered>···</Centered>
          ) : (
            <div className="mx-auto flex max-w-[920px] flex-col gap-10">
              {chapters.map((ch, ci) => {
                const pages = skeleton.pages.slice(ch.pageStart, ch.pageEnd);
                const active = stage === 'chapter' && ci === chapterIdx;
                return (
                  <section
                    key={ch.chapterId}
                    className={`rounded-[var(--radius-lg)] p-4 transition-shadow ${
                      active ? 'shadow-[0_0_0_2px_var(--accent)]' : ''
                    }`}
                  >
                    <div className="mb-3 flex items-center gap-2.5">
                      <h3 className="text-[var(--text-sm)] font-bold tracking-tight text-[var(--fg)]">{ch.label}</h3>
                      <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[var(--text-xs)] text-[var(--fg-2)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                        {t.states[ch.state]}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {pages.map((p) => (
                        <PagePreview
                          key={p.pageIndex}
                          page={p}
                          totalPages={totalPages}
                          resolveImage={resolveImage}
                          scale={0.4}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </main>

        {/* ── Right: jellyfish chat rail ── */}
        <aside className="hidden border-l border-[var(--border-soft)] lg:block">
          <div className="flex h-full flex-col bg-[var(--surface)]">
            <div className="flex flex-shrink-0 items-center gap-3 px-5 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-sm)] font-bold text-white">
                {t.aiAvatar}
              </span>
              <div className="min-w-0">
                <h3 className="text-[var(--text-sm)] font-bold tracking-tight">{t.aiName}</h3>
                <div className="text-[var(--text-xs)] text-[var(--muted)]">{t.subtitle}</div>
              </div>
            </div>

            {/* Current-chapter banner + stepper (chapter stage only) */}
            {stage === 'chapter' && currentChapter && (
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-y border-[var(--border-soft)] bg-[var(--bg)] px-5 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[var(--text-sm)] font-medium text-[var(--fg)]">{currentChapter.label}</div>
                  <div className="text-[var(--text-xs)] text-[var(--muted)]">{t.askProgress(currentChapter.askCount)}</div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <StepBtn
                    label={t.prevChapter}
                    disabled={chapterIdx === 0 || busy}
                    onClick={() => setChapterIdx((i) => Math.max(0, i - 1))}
                    dir="prev"
                  />
                  <StepBtn
                    label={t.nextChapter}
                    disabled={chapterIdx >= chapters.length - 1 || busy}
                    onClick={() => setChapterIdx((i) => Math.min(chapters.length - 1, i + 1))}
                    dir="next"
                  />
                </div>
              </div>
            )}

            {/* Transcript */}
            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === 'user'
                      ? 'self-end rounded-2xl rounded-br-sm bg-[var(--accent)] px-3.5 py-2 text-[13.5px] leading-relaxed text-white'
                      : 'self-start rounded-2xl rounded-bl-sm bg-[var(--bg)] px-3.5 py-2 text-[13.5px] leading-relaxed text-[var(--fg-2)]'
                  }
                  style={{ maxWidth: '85%' }}
                >
                  {m.content}
                </div>
              ))}
              {busy && (
                <div className="self-start text-[var(--text-xs)] text-[var(--muted)]">{t.thinking}</div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-shrink-0 flex-col gap-2 px-3 pb-1">
              {stage === 'theme' ? (
                <button
                  type="button"
                  onClick={enterChapters}
                  disabled={busy || !skeleton}
                  className="w-full rounded-full bg-[var(--bg)] px-4 py-2 text-[var(--text-sm)] font-medium text-[var(--fg-2)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--surface)] disabled:opacity-40"
                >
                  {t.enterChapters}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setChapterIdx((i) => Math.min(chapters.length - 1, i + 1))}
                  disabled={busy || chapterIdx >= chapters.length - 1}
                  className="w-full rounded-full bg-[var(--bg)] px-4 py-2 text-[var(--text-sm)] font-medium text-[var(--fg-2)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--surface)] disabled:opacity-40"
                >
                  {t.skipChapter}
                </button>
              )}
              <button
                type="button"
                onClick={finalize}
                disabled={busy || finishing || !skeleton}
                className="w-full rounded-full bg-[var(--fg)] px-4 py-2 text-[var(--text-sm)] font-semibold text-white transition-colors hover:bg-black disabled:opacity-40"
              >
                {finishing ? t.finishing : t.finishAll}
              </button>
              <p className="px-1 text-[11px] leading-snug text-[var(--meta)]">{t.finishHint}</p>
            </div>

            {/* Input */}
            <div className="m-3 flex flex-shrink-0 items-end rounded-3xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MESSAGE_MAX))}
                maxLength={MESSAGE_MAX}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                disabled={busy || finishing || loadState !== 'ready'}
                placeholder={stage === 'theme' ? t.inputThemePlaceholder : t.inputChapterPlaceholder}
                className="max-h-[100px] flex-1 resize-none border-none bg-transparent py-3 pl-[18px] text-[13.5px] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || finishing || !input.trim()}
                title={t.send}
                aria-label={t.send}
                className="m-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-opacity disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="max-w-sm text-center text-[var(--muted)]">{children}</p>
    </div>
  );
}

function StepBtn({
  label,
  disabled,
  onClick,
  dir,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  dir: 'prev' | 'next';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:opacity-30"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
        {dir === 'prev' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}
