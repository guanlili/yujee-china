'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import {
  fetchChapterSummary,
  postChapterContexts,
  type ChapterContextEntry,
} from '@/lib/album/authoring-client';
import { interviewDataFromStore, UnauthorizedError } from '@/lib/generation/client';
import { albumInterview, albumRecipe } from '@/lib/generation/draft';
import {
  buildChapterContext,
  buildChapterInterviews,
  type ChapterInterview,
} from '@/lib/interview/interview';

// 内容采集(分组后采访)对话框(§2.1a)。analyze 完成、排版前弹一次:逐章用 AI 风格
// 三条短消息引导用户答一段文字,把「时间/地点(预填)+ 用户原话」拼成 chapterContext 存回,
// 喂给排版和写文案。可跳过(整册或逐章)。全程坐标不出浏览器(预填地名已是字符串)。
//
// 完成/跳过后置 albumInterview.markDone 并 onDone() —— 由 page 重启轮询,放行 select-layout。
interface Props {
  albumId: string;
  locale: Locale;
  onDone: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; interviews: ChapterInterview[] }
  | { kind: 'error' };

function ThinkingDots() {
  const base = 'h-[3.5px] w-[3.5px] rounded-full [animation:yujee-dot-bounce_1.4s_ease-in-out_infinite]';
  return (
    <span className="ml-0.5 inline-flex items-center gap-[3px]">
      <span className={`${base} bg-[var(--grad-green)]`} />
      <span className={`${base} bg-[var(--grad-purple)] [animation-delay:0.16s]`} />
      <span className={`${base} bg-[var(--grad-lime)] [animation-delay:0.32s]`} />
    </span>
  );
}

const COPY = {
  zh: {
    skipAll: '跳过',
    next: '下一段',
    finish: '完成',
    placeholder: '随便聊聊，或点跳过',
    stepOf: (i: number, n: number) => `第 ${i} / ${n} 段`,
  },
  en: {
    skipAll: 'Skip',
    next: 'Next',
    finish: 'Done',
    placeholder: 'Say a little, or skip',
    stepOf: (i: number, n: number) => `${i} / ${n}`,
  },
} as const;

export function InterviewDialog({ albumId, locale, onDone }: Props) {
  const t = COPY[locale === 'zh' ? 'zh' : 'en'];
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  // 逐章推进:当前章序号 + 已收集的答案。
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<ChapterContextEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(0); // 三条短消息逐条冒出的进度
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 组装每章采访条目:章(photoIds) × 提交时预填(clusterId→时间/地点) via photoId→clusterId。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const recipe = albumRecipe.load(albumId);
        const [{ chapters }, data] = await Promise.all([
          fetchChapterSummary(albumId),
          recipe ? interviewDataFromStore(recipe.photoIds) : Promise.resolve({ photoToCluster: new Map<string, string>(), prefills: [] }),
        ]);
        if (cancelled) return;
        const interviews = buildChapterInterviews(chapters, data.photoToCluster, data.prefills);
        // 没有章(异常)=> 直接放行,不挡排版。
        if (interviews.length === 0) {
          finishAll([]);
          return;
        }
        setLoad({ kind: 'ready', interviews });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof UnauthorizedError) {
          window.location.href = '/sign-in';
          return;
        }
        // 采访是可选的:加载失败就直接放行,绝不挡住排版。
        finishAll([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  // 三条短消息逐条冒出(模仿真人一句一句打字)。
  useEffect(() => {
    if (load.kind !== 'ready') return;
    setRevealed(1);
    const timers = [
      setTimeout(() => setRevealed(2), 700),
      setTimeout(() => setRevealed(3), 1400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [load, step]);

  useEffect(() => {
    if (revealed >= 3) inputRef.current?.focus();
  }, [revealed]);

  // 收尾:置标记 + 存已收集答案(可能为空=全跳过)+ 通知 page 放行。存失败也放行(采访可选)。
  async function finishAll(collected: ChapterContextEntry[]) {
    setSaving(true);
    albumInterview.markDone(albumId);
    try {
      const nonEmpty = collected.filter((c) => c.chapterContext.trim().length > 0);
      if (nonEmpty.length > 0) await postChapterContexts(albumId, nonEmpty);
    } catch {
      // 采访可选:存失败不阻塞,已 markDone,排版照常。
    }
    onDone();
  }

  if (load.kind === 'loading') {
    return (
      <Overlay>
        <div className="flex items-center gap-2 text-sm text-[var(--fg)]/70">
          <ThinkingDots />
        </div>
      </Overlay>
    );
  }
  if (load.kind !== 'ready') return null;

  const interviews = load.interviews;
  const current = interviews[step]!;
  const isLast = step === interviews.length - 1;

  const advance = () => {
    const context = buildChapterContext(current.input, draft);
    const collected = [...answers, { chapterId: current.chapterId, chapterContext: context }];
    setAnswers(collected);
    setDraft('');
    if (isLast) {
      void finishAll(collected);
    } else {
      setStep((s) => s + 1);
      setRevealed(0);
    }
  };

  return (
    <Overlay>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--fg)]/40">{t.stepOf(step + 1, interviews.length)}</span>
        <button
          type="button"
          onClick={() => void finishAll(answers)}
          disabled={saving}
          className="text-xs text-[var(--fg)]/50 underline-offset-2 hover:underline disabled:opacity-40"
        >
          {t.skipAll}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {current.messages.slice(0, revealed).map((msg, i) => (
          <div
            key={i}
            className="max-w-[85%] self-start rounded-2xl rounded-tl-sm bg-[var(--fg)]/[0.05] px-3.5 py-2 text-[15px] leading-relaxed text-[var(--fg)]"
          >
            {msg}
          </div>
        ))}
        {revealed < 3 && (
          <div className="self-start rounded-2xl bg-[var(--fg)]/[0.05] px-3.5 py-2.5">
            <ThinkingDots />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              advance();
            }
          }}
          rows={2}
          placeholder={t.placeholder}
          disabled={saving}
          className="flex-1 resize-none rounded-xl border border-[var(--fg)]/10 bg-white px-3 py-2 text-[15px] outline-none focus:border-[var(--fg)]/25"
        />
        <button
          type="button"
          onClick={advance}
          disabled={saving}
          className="rounded-xl bg-[var(--fg)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {isLast ? t.finish : t.next}
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <div className="w-[min(92vw,440px)] rounded-2xl bg-white p-5 shadow-[0_8px_40px_rgba(0,0,0,0.16)]">
        {children}
      </div>
    </div>
  );
}
