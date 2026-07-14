'use client';

import { adaptPageToTemplateData, type ResolveImage } from './adapt-layout';
import { PAGE } from './templates/constants';
import { preferredPageHtml } from './page-html-dom';
import { FittedPageHtml } from './FittedPageHtml';
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
  // 页面真相 = 存库 html(含手工版面);缺失时模板即时渲染,再缺回退 React 组件。
  const html = preferredPageHtml(page, resolveImage);
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
          <FittedPageHtml html={html} />
        ) : Template && data ? (
          <Template data={data} totalPages={totalPages} imagePos={page.imagePosJson} />
        ) : (
          <div style={{ padding: 24, fontSize: 14 }}>Unknown template: {page.templateId}</div>
        )}
      </div>
    </div>
  );
}
