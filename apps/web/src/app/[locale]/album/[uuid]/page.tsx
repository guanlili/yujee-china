'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAlbumPoll } from '@/lib/hooks/use-album-poll';
import { EditorPort } from '@/components/album/editor-v2/EditorPort';
import type { AlbumDetail } from '@/components/album/types';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';

// Loading/building modes never read page content, so the first poll frame can
// hand them this minimal stub.
const STUB_DETAIL = (uuid: string): AlbumDetail => ({
  album: {
    id: uuid,
    title: '',
    status: 'AGENT_RUNNING',
    prompt: '',
    layoutJson: null,
    photoCount: 0,
    pageCount: 0,
    pdfUrl: null,
    errorMessage: null,
    createdAt: new Date(0).toISOString(),
  },
  pages: [],
});

// Editor lives under [locale] for 2-language support (architecture §6.5.7). The
// create flow still pushes the unprefixed /album/<uuid>; next-intl middleware
// (localePrefix: 'always') redirects it here with the resolved locale prefix, so
// this is the single real implementation — no stub re-export.
export default function AlbumPage({
  params,
}: {
  params: Promise<{ locale: string; uuid: string }>;
}) {
  const { locale: rawLocale, uuid } = use(params);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const router = useRouter();

  // Source of truth is the album itself, addressed by uuid — not a job id from
  // the URL. A bookmarked/ready album loads immediately; a dead generation is
  // swept to FAILED server-side and surfaces here instead of spinning forever.
  const { detail, generation, phase, error } = useAlbumPoll(uuid);

  // Session expired mid-generation → don't spin, send them to sign in and back.
  useEffect(() => {
    if (phase === 'unauthorized') {
      const from = `/${locale}/album/${uuid}`;
      router.push(`/${locale}/login?from=${encodeURIComponent(from)}`);
    }
  }, [phase, router, locale, uuid]);

  // The editor is the single page across the whole album lifecycle (W10 flow
  // unification): EditorPort renders for every non-terminal phase, switching mode
  // internally. page.tsx owns just the mode decision:
  //   • loading                         → full-screen editor resource loader.
  //   • running (AGENT_RUNNING)         → AI waiting state: canvas shell + chat.
  //   • EDITING & layoutJson == null      → authoring: draft skeleton + agent chat.
  //   • layoutJson set (EDITING/COMPLETED)→ editing: the finalized editor.
  // layoutJson is the draft↔finalized discriminator (mirrors the server's
  // albumAuthoringService.loadDraftAlbum). Leaving and returning via the URL
  // resumes naturally: a fresh useAlbumPoll re-derives the phase.
  // 解耦后:analyze 完成 → 相册直接 EDITING/story(不再靠 init job 停在 stage='layout' 驱动)。
  // 收集故事 + 排版中都在 EDITING 态,由下面 phase==='ready' 的 authoring 分支处理(采访面板 +
  // 排版完 EditorPort 内部重挂 EditorBook)。这里的 running 只剩「分析进行中」→ building/AI waiting。
  if (phase === 'loading') {
    return (
      <EditorPort
        detail={detail ?? STUB_DETAIL(uuid)}
        locale={locale}
        mode="loading"
        generation={generation}
      />
    );
  }

  if (phase === 'running') {
    return (
      <EditorPort
        detail={detail ?? STUB_DETAIL(uuid)}
        locale={locale}
        mode="building"
        generation={generation}
      />
    );
  }

  if (phase === 'ready' && detail) {
    const { status, layoutJson } = detail.album;
    const mode = status === 'EDITING' && layoutJson == null ? 'authoring' : 'editing';
    return <EditorPort detail={detail} locale={locale} mode={mode} />;
  }

  // Terminal error states (failed / gone / error) surface through the SAME editor
  // chrome as building — EditorPort mode="error" (W10 flow unification): no separate
  // full-page error layout. unauthorized (handled by the redirect effect above) and
  // the rare ready-without-detail fall back to the neutral editor loader for the
  // frame before navigation/re-render resolves.
  if (phase === 'failed' || phase === 'gone' || phase === 'error') {
    return (
      <EditorPort
        detail={detail ?? STUB_DETAIL(uuid)}
        locale={locale}
        mode="error"
        errorKind={phase}
        errorMessage={error}
      />
    );
  }
  return <EditorPort detail={detail ?? STUB_DETAIL(uuid)} locale={locale} mode="loading" />;
}
