'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { TEMPLATE_REGISTRY } from '@/components/album/templates/registry';
import { PAGE } from '@/components/album/templates/constants';
import type { TemplateData } from '@/components/album/templates/types';

const PdfViewer = dynamic(() => import('./PdfViewer').then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, fontSize: 14, color: '#888' }}>Loading PDF preview…</div>
  ),
});

interface Props {
  templateId: string;
  data: TemplateData;
}

export function TemplatePreviewClient({ templateId, data }: Props) {
  const entry = TEMPLATE_REGISTRY[templateId];
  const [tab, setTab] = useState<'web' | 'pdf'>('web');

  if (!entry) {
    return <div style={{ padding: 32 }}>模板 {templateId} 未注册</div>;
  }

  const { WebTemplate } = entry;
  // 缩放因子:Web 渲染按 1:1,容器外再用 CSS 缩放避免溢出。
  const scale = 0.7;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['web', 'pdf'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              borderRadius: 4,
              border: '1px solid #d8d2c4',
              background: tab === t ? '#1c1b18' : '#fff',
              color: tab === t ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {t === 'web' ? 'Web 渲染' : 'PDF 渲染 (@react-pdf)'}
          </button>
        ))}
      </div>

      {tab === 'web' ? (
        <div
          style={{
            width: PAGE.width * scale,
            height: PAGE.height * scale,
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            background: '#fff',
            overflow: 'hidden',
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
            <WebTemplate data={data} totalPages={30} />
          </div>
        </div>
      ) : (
        <PdfViewer templateId={templateId} data={data} />
      )}
    </div>
  );
}
