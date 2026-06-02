'use client';

import { adaptPageToTemplateData, type ResolveImage } from './adapt-layout';
import { PAGE } from './templates/constants';
import type { EditorPage } from './types';
import { getWebTemplate } from './web-registry';

interface Props {
  page: EditorPage;
  totalPages: number;
  resolveImage: ResolveImage;
  scale?: number;
}

// Renders one album page through its real web template at a fixed scale. The
// editor uses FlipBook; this compact renderer is still needed for album cards.
export function PagePreview({ page, totalPages, resolveImage, scale = 0.46 }: Props) {
  const Template = getWebTemplate(page.templateId);
  const data = adaptPageToTemplateData(
    { templateId: page.templateId, images: page.imagesJson, texts: page.textsJson },
    resolveImage,
  );

  return (
    <div
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
        {Template ? (
          <Template data={data} totalPages={totalPages} />
        ) : (
          <div style={{ padding: 24, fontSize: 14 }}>Unknown template: {page.templateId}</div>
        )}
      </div>
    </div>
  );
}
