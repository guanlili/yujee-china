'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, LayoutPatchEntry } from './types';

interface Props {
  albumId: string;
  language: 'zh' | 'en';
  onPatch: (patch: LayoutPatchEntry[]) => void;
}

// Natural-language editing. POST /chat is synchronous (the user waits); on
// success we append both turns and hand the patch up so the preview updates.
export function ChatPanel({ albumId, language, onPatch }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/albums/${albumId}/messages`);
        const json = await res.json();
        if (!cancelled && json.ok) setMessages(json.data.messages);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);
    setMessages((m) => [
      ...m,
      { id: `tmp-${Date.now()}`, role: 'user', content: text, layoutPatch: null, createdAt: new Date().toISOString() },
    ]);
    setInput('');
    try {
      const res = await fetch(`/api/v1/albums/${albumId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, language }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? 'Chat failed');
        return;
      }
      const { assistantReply, layoutPatch, messageId } = json.data;
      setMessages((m) => [
        ...m,
        { id: messageId, role: 'assistant', content: assistantReply, layoutPatch, createdAt: new Date().toISOString() },
      ]);
      onPatch(layoutPatch as LayoutPatchEntry[]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <p className="text-sm font-medium mb-3">Ask AI to edit</p>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.length === 0 && (
          <p className="text-xs text-[var(--muted)]">
            e.g. &ldquo;make the cover title bolder&rdquo; or &ldquo;rewrite page 2 to feel more nostalgic&rdquo;
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`text-sm rounded-lg px-3 py-2 ${
              m.role === 'user'
                ? 'bg-[var(--accent)] text-white ml-6'
                : 'bg-white border border-[var(--border)] mr-6'
            }`}
          >
            {m.content}
          </div>
        ))}
        {busy && <div className="text-xs text-[var(--muted)] mr-6">AI is editing…</div>}
        <div ref={endRef} />
      </div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Describe a change…"
          className="flex-1 text-sm border border-[var(--border)] rounded-full px-4 py-2 bg-white"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-4 py-2 rounded-full bg-[var(--accent)] text-white text-sm disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
