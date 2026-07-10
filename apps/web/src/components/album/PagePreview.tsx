'use client';

import { adaptPageToTemplateData, type ResolveImage } from './adapt-layout';
import { PAGE } from './templates/constants';
import { renderPageHtml } from './templates/html/fill-template';
import type { EditorPage } from './types';
import { getWebTemplate } from './web-registry';
import { useAlbumFonts } from '@/lib/font/album-font-loader';

interface Props {
  page: EditorPage;
  totalPages: number;
  resolveImage: ResolveImage;
  scale?: number;
}

// Renders one album page through its real web template at a fixed scale. The
// editor uses FlipBook; this compact renderer is still needed for album cards.
export function PagePreview({ page, totalPages, resolveImage, scale = 0.46 }: Props) {
  const fontsReady = useAlbumFonts([{ texts: page.textsJson }]);
  // HTML 模板已迁移的走单一渲染器（dangerouslySetInnerHTML），未迁的回退 React 组件。
  const html = renderPageHtml(
    { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson, imagePos: page.imagePosJson },
    resolveImage,
  );
  const Template = html === undefined ? getWebTemplate(page.templateId) : null;
  const data =
    Template != null
      ? adaptPageToTemplateData(
          { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
          resolveImage,
        )
      : null;

  return (
    <div
      data-album-fonts-ready={fontsReady}
      style={{
        width: PAGE.width * scale,
        height: PAGE.height * scale,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: PAGE.width,
          height: PAGE.height,
        }}
      >
        {html !== undefined ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : Template && data ? (
          <Template data={data} totalPages={totalPages} imagePos={page.imagePosJson} />
        ) : (
          <div style={{ padding: 24, fontSize: 14 }}>Unknown template: {page.templateId}</div>
        )}
      </div>
    </div>
  );
}
