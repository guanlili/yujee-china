'use client';

import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { Brand } from '@/components/app/Brand';
import { RetryFailedButton } from './RetryFailedButton';
import { PAGE } from './templates/constants';

type ShellPhase = 'loading' | 'running' | 'failed' | 'gone' | 'error';

interface Props {
  locale: Locale;
  albumId: string;
  phase: ShellPhase;
  generation: { stage: string | null; progress: number } | null;
  error: string | null;
}

type StageLabels = Record<string, string> & { starting: string };

export function resolveGenerationStageLabel(stage: string | null | undefined, labels: StageLabels): string {
  if (!stage) return labels.starting;
  return labels[stage] ?? stage;
}

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

function DisabledSendIcon({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title={label}
      aria-label={label}
      className="m-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-white opacity-30 shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    </button>
  );
}

function PageSkeleton({ progress }: { progress: number }) {
  const scale = 0.42;
  return (
    <div className="group relative">
      <div
        className="relative overflow-hidden bg-[var(--surface)] shadow-[var(--shadow-card)]"
        style={{ width: PAGE.width * scale, height: PAGE.height * scale }}
        aria-hidden
      >
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[var(--surface)] via-[var(--bg)] to-[var(--border-soft)]" />
        <div className="absolute inset-x-10 top-10 h-28 rounded-[var(--radius-md)] bg-[rgba(235,235,235,0.8)]" />
        <div className="absolute left-10 top-44 h-5 w-32 rounded-full bg-[var(--border)]" />
        <div className="absolute left-10 right-10 top-56 space-y-3">
          <div className="h-3 rounded-full bg-[var(--border-soft)]" />
          <div className="h-3 rounded-full bg-[var(--border-soft)]" />
          <div className="h-3 w-3/4 rounded-full bg-[var(--border-soft)]" />
        </div>
        <div className="absolute bottom-14 left-10 right-10 grid grid-cols-2 gap-4">
          <div className="h-24 rounded-[var(--radius-md)] bg-[rgba(235,235,235,0.8)]" />
          <div className="h-24 rounded-[var(--radius-md)] bg-[rgba(235,235,235,0.8)]" />
        </div>
      </div>
      <div className="absolute -bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[rgba(255,255,255,0.85)] px-3 py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-md">
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--border)]">
          <span
            className="block h-full rounded-full bg-[var(--accent)] transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </span>
        <span className="font-mono text-[10px] font-medium tabular-nums text-[var(--fg-2)]">{progress}%</span>
      </div>
    </div>
  );
}

export function AlbumGeneratingShell({ locale, albumId, phase, generation, error }: Props) {
  const t = getMessages(locale).dashboard.editor;
  const progress = Math.max(0, Math.min(100, generation?.progress ?? 0));
  const stageLabel = resolveGenerationStageLabel(generation?.stage, t.stage);
  const isGenerating = phase === 'loading' || phase === 'running';
  const stateLabel = phase === 'loading' ? t.stateLoading : t.stateGenerating;
  const statusLabel =
    phase === 'failed' ? t.failedTitle : phase === 'gone' ? t.goneTitle : phase === 'error' ? t.slowTitle : stateLabel;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]">
      <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--surface)] px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href={`/${locale}/my-albums`}
            title={t.backToProjects}
            aria-label={t.backToProjects}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <Brand href={`/${locale}`} />
          <span className="text-[var(--meta)] text-[var(--text-sm)]">/</span>
          <span className="max-w-[40vw] truncate rounded-full px-2 py-1 font-bold text-[var(--text-sm)] text-[var(--fg)]">
            {t.untitled}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--bg)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--muted)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--grad-lime)]" />
            <span>{statusLabel}</span>
          </span>
        </div>
        <div className="hidden items-center gap-2 text-[var(--text-xs)] text-[var(--muted)] sm:flex">
          <span>{stageLabel}</span>
          {isGenerating && <span className="font-mono tabular-nums">{progress}%</span>}
        </div>
      </header>

      <div className="relative grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_340px]">
        <main className="relative flex items-center justify-center overflow-auto bg-[var(--bg)] p-8">
          {phase === 'failed' ? (
            <div className="max-w-md text-center">
              <p className="text-3xl font-bold text-[#c44]">{t.failedTitle}</p>
              <p className="mt-3 text-[var(--muted)]">{error ?? t.failedBodyDefault}</p>
              <p className="mt-1 text-[var(--text-sm)] text-[var(--muted)]">{t.failedNoCharge}</p>
              <div className="flex justify-center">
                <RetryFailedButton albumId={albumId} />
              </div>
              <Link
                href={`/${locale}/my-albums`}
                className="mt-6 inline-block text-[var(--text-sm)] text-[var(--accent)] underline underline-offset-2"
              >
                {t.backToProjects}
              </Link>
            </div>
          ) : phase === 'gone' ? (
            <div className="max-w-md text-center">
              <p className="text-3xl font-bold text-[#c44]">{t.goneTitle}</p>
              <p className="mt-3 text-[var(--muted)]">{t.goneBody}</p>
              <Link
                href={`/${locale}/my-albums`}
                className="mt-6 inline-block text-[var(--text-sm)] text-[var(--accent)] underline underline-offset-2"
              >
                {t.backToProjects}
              </Link>
            </div>
          ) : phase === 'error' ? (
            <div className="max-w-md text-center">
              <p className="text-3xl font-bold">{t.slowTitle}</p>
              <p className="mt-3 text-[var(--muted)]">{error ?? t.slowBody}</p>
            </div>
          ) : (
            <PageSkeleton progress={progress} />
          )}
        </main>

        <aside className="hidden border-l border-[var(--border-soft)] lg:block">
          <div className="flex h-full flex-col bg-[var(--surface)]">
            <div className="flex flex-shrink-0 items-center gap-3 px-5 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-sm)] font-bold text-white">
                {t.aiAvatarChar}
              </span>
              <div className="min-w-0">
                <h3 className="text-[var(--text-sm)] font-bold tracking-tight">{t.aiName}</h3>
                <div className="text-[var(--text-xs)] text-[var(--muted)]">{t.chatSubtitle}</div>
              </div>
              <span className="ml-auto rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[var(--text-xs)] text-[var(--fg-2)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                {isGenerating ? stateLabel : t.chatContext}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
              {isGenerating ? (
                <div className="flex items-center gap-2 text-[var(--muted)]">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-[var(--grad-purple)] [animation:yujee-think-pulse_1.5s_ease-in-out_infinite]">
                    <span className="h-[5px] w-[5px] rounded-full bg-gradient-to-br from-[var(--grad-green)] to-[var(--grad-purple)]" />
                  </span>
                  <span className="font-mono text-[var(--text-xs)]">{t.thinking}</span>
                  <ThinkingDots />
                </div>
              ) : (
                <p className="text-[var(--text-xs)] leading-relaxed text-[var(--muted)]">
                  {phase === 'failed' ? error ?? t.failedBodyDefault : phase === 'gone' ? t.goneBody : t.slowBody}
                </p>
              )}
              <p className="text-[13.5px] leading-[1.8] text-[var(--fg-2)]">{stageLabel}</p>
            </div>
            <div className="m-3 flex flex-shrink-0 items-end rounded-full border border-[var(--border-soft)] bg-[var(--surface)] opacity-60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <textarea
                value=""
                rows={1}
                disabled
                placeholder={t.inputPlaceholder}
                className="max-h-[100px] flex-1 resize-none border-none bg-transparent py-3 pl-[18px] text-[13.5px] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
              />
              <DisabledSendIcon label={t.send} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
