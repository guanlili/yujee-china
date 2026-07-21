'use client';

import { useState } from 'react';
import { FlipBook } from './FlipBook';
import type { ResolveImage } from './adapt-layout';
import type { EditorPage } from './types';
import { presetImageUrl } from '@/lib/board-bg/presets';

export type SharedBoardBackground =
  | { kind: 'color'; color: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'upload'; key: string }
  | null;

const STRINGS = {
  zh: { prevPage: '上一页', nextPage: '下一页', noPages: '暂无内容', editPage: '', pageIndicator: '{current} / {total}' },
  en: { prevPage: 'Previous', nextPage: 'Next', noPages: 'Nothing to show', editPage: '', pageIndicator: '{current} / {total}' },
} as const;

// 免登只读分享视图:复用编辑器的 FlipBook 翻书;不传 onEditPage => 铅笔按钮不渲染,纯只读。
// 图片走冻结的公开快照 URL(photoUrls),不碰本地 IndexedDB —— 别人浏览器也能看。
export function SharedAlbum({
  pages,
  photoUrls,
  boardBackground,
  locale,
  title,
}: {
  pages: EditorPage[];
  photoUrls: Record<string, string>;
  boardBackground: SharedBoardBackground;
  locale: string;
  title: string;
}) {
  const [selected, setSelected] = useState(0);
  const resolveImage: ResolveImage = (id: string) => photoUrls[id];
  const t = STRINGS[locale === 'en' ? 'en' : 'zh'];

  // 画板底:纯色 / 内置预设图(公开)可复现;上传图是本地引用,分享环境取不到 → 退中性底。
  const bgStyle: React.CSSProperties = {};
  if (boardBackground?.kind === 'color') bgStyle.background = boardBackground.color;
  else if (boardBackground?.kind === 'preset') {
    bgStyle.backgroundImage = `url("${presetImageUrl(boardBackground.presetId)}")`;
    bgStyle.backgroundSize = 'cover';
    bgStyle.backgroundPosition = 'center';
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)]">
      <header className="flex flex-shrink-0 items-center justify-center border-b border-[var(--border-soft)] px-4 py-3">
        <h1 className="truncate text-[var(--text-sm)] font-semibold text-[var(--fg)]">{title}</h1>
      </header>
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-8" style={bgStyle}>
        <FlipBook
          pages={pages}
          totalPages={pages.length}
          resolveImage={resolveImage}
          selected={selected}
          onSelect={setSelected}
          t={t}
        />
      </main>
    </div>
  );
}
