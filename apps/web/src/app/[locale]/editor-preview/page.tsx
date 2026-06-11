// ─────────────────────────────────────────────────────────────────────────────
// Login-free visual check of the editor shell (the faithful 1:1 port of
// /Users/smalldog/Desktop/yujee-editor/editor.html — see EditorPort.tsx).
//
// Phase B wired EditorPort to real album data, so this route now feeds a small
// mock AlbumDetail (real templateIds, no originals — images resolve to nothing,
// which is fine for a chrome/layout check). Open /<locale>/editor-preview to
// compare the shell against the design side-by-side. The real, data-backed
// editor lives at /<locale>/album/<uuid> and is unaffected by this route.
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { use } from 'react';
import { EditorPort } from '@/components/album/editor-v2/EditorPort';
import type { AlbumDetail } from '@/components/album/types';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';

const MOCK_DETAIL: AlbumDetail = {
  album: {
    id: 'preview',
    title: 'Editor Preview',
    status: 'EDITING',
    prompt: '',
    layoutJson: null,
    photoCount: 0,
    pageCount: 6,
    pdfUrl: null,
    errorMessage: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  pages: ['mag-01', 'mag-02', 'mag-03', 'mag-04', 'mag-05', 'mag-06'].map((templateId, i) => ({
    pageIndex: i,
    templateId,
    imagesJson: {},
    textsJson: {},
  })),
};

export default function EditorPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = use(params);
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  return <EditorPort detail={MOCK_DETAIL} locale={locale} />;
}
