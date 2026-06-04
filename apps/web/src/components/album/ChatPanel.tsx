'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import type { ChatMessage, LayoutPatchEntry } from './types';

interface Props {
  albumId: string;
  locale: Locale;
  language: 'zh' | 'en';
  onPatch: (patch: LayoutPatchEntry[]) => void;
}

// Pull the text the AI changed out of a patch so it can be shown back as a
// citation card — the user sees exactly what landed in the magazine.
function changedText(patch: unknown): string {
  if (!Array.isArray(patch)) return '';
  const out: string[] = [];
  for (const entry of patch as LayoutPatchEntry[]) {
    if (entry?.textsJson) out.push(...Object.values(entry.textsJson).filter(Boolean));
  }
  return out.join('\n\n').trim();
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

// Natural-language editing (design-v1 editor.html chat pane). POST /chat is
// synchronous (the user waits); on success we append both turns, surface the AI
// reply as plain text, cite any text it changed in a quote card, and hand the
// patch up so the preview updates in place.
export function ChatPanel({ albumId, locale, language, onPatch }: Props) {
  const t = getMessages(locale).dashboard.editor;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/messages`);
        const json = await res.json();
        if (!cancelled && json.ok) setMessages(json.data.messages);
      } catch {
        /* non-fatal — empty history just shows the hint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    setMessages((m) => [
      ...m,
      { id: `tmp-${m.length}`, role: 'user', content: trimmed, layoutPatch: null, createdAt: '' },
    ]);
    setInput('');
    try {
      const res = await fetch(`/api/v1/albums/${albumId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, language }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? t.chatError);
        return;
      }
      const { assistantReply, layoutPatch, messageId } = json.data;
      setMessages((m) => [
        ...m,
        { id: messageId, role: 'assistant', content: assistantReply, layoutPatch, createdAt: '' },
      ]);
      onPatch(layoutPatch as LayoutPatchEntry[]);
    } catch {
      setErr(t.chatError);
    } finally {
      setBusy(false);
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--surface)]">
      {/* head */}
      <div className="flex flex-shrink-0 items-center gap-3 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-sm)] font-bold text-white">
          {t.aiAvatarChar}
        </span>
        <div className="min-w-0">
          <h3 className="text-[var(--text-sm)] font-bold tracking-tight">{t.aiName}</h3>
          <div className="text-[var(--text-xs)] text-[var(--muted)]">{t.chatSubtitle}</div>
        </div>
        <span className="ml-auto rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[var(--text-xs)] text-[var(--fg-2)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {t.chatContext}
        </span>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !busy && (
          <p className="text-[var(--text-xs)] leading-relaxed text-[var(--muted)]">{t.chatEmpty}</p>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-[16px_4px_16px_16px] bg-[var(--bg)] px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--fg)]">
                  {m.content}
                </div>
              </div>
            );
          }
          const quote = changedText(m.layoutPatch);
          return (
            <div key={m.id}>
              <div className="mb-2 flex items-center gap-2 text-[var(--muted)]">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-[var(--grad-purple)]">
                  <span className="h-[5px] w-[5px] rounded-full bg-gradient-to-br from-[var(--grad-green)] to-[var(--grad-purple)]" />
                </span>
                <span className="font-mono text-[var(--text-xs)] tracking-tight">{t.thinkingDone}</span>
              </div>
              <div className="text-[13.5px] leading-[1.8] text-[var(--fg-2)] whitespace-pre-wrap">{m.content}</div>
              {quote && (
                <>
                  <div className="mt-2.5 rounded-[var(--radius-lg)] bg-[var(--bg)] px-[18px] py-3.5 text-[13px] italic leading-[1.9] text-[var(--fg-2)] whitespace-pre-wrap">
                    {quote}
                  </div>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => sendMessage(t.chipRewriteMessage)}
                      disabled={busy}
                      className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[var(--text-sm)] font-medium text-[var(--fg-2)] transition-colors hover:border-[var(--fg-2)] hover:bg-[#ebebeb] hover:text-[var(--fg)] disabled:opacity-40"
                    >
                      {t.chipRewrite}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-[var(--muted)]">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-[var(--grad-purple)] [animation:yujee-think-pulse_1.5s_ease-in-out_infinite]">
              <span className="h-[5px] w-[5px] rounded-full bg-gradient-to-br from-[var(--grad-green)] to-[var(--grad-purple)]" />
            </span>
            <span className="font-mono text-[var(--text-xs)]">{t.thinking}</span>
            <ThinkingDots />
          </div>
        )}
        {err && <p className="text-[var(--text-xs)] text-[#c44]">{err}</p>}
        <div ref={endRef} />
      </div>

      {/* input */}
      <div className="m-3 flex flex-shrink-0 items-end rounded-full border border-[var(--border-soft)] bg-[var(--surface)] shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_rgba(140,94,244,0.12)]">
        <textarea
          ref={inputRef}
          value={input}
          maxLength={500}
          rows={1}
          disabled={busy}
          placeholder={t.inputPlaceholder}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(input);
            }
          }}
          className="max-h-[100px] flex-1 resize-none border-none bg-transparent py-3 pl-[18px] text-[13.5px] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
        />
        <button
          type="button"
          onClick={() => void sendMessage(input)}
          disabled={busy || !input.trim()}
          title={t.send}
          aria-label={t.send}
          className="m-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all hover:-translate-y-px hover:bg-[var(--fg-2)] disabled:translate-y-0 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
