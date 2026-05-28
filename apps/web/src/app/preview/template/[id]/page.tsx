import { notFound } from 'next/navigation';
import Link from 'next/link';
import { TEMPLATE_IDS } from '@yujee/contracts/templates';
import { TEMPLATE_REGISTRY } from '@/components/album/templates/registry';
import { SAMPLE_DATA } from '@/components/album/templates/sample-data';
import { TemplatePreviewClient } from './TemplatePreviewClient';

interface Params {
  params: Promise<{ id: string }>;
}

export default async function TemplatePreviewPage({ params }: Params) {
  const { id } = await params;
  const entry = TEMPLATE_REGISTRY[id];
  if (!entry) notFound();

  const data = SAMPLE_DATA[id] ?? {};

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: '#f4f1ea', minHeight: '100vh' }}>
      <header
        style={{
          padding: '20px 32px',
          borderBottom: '1px solid #e2dccd',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.2em', color: '#888', textTransform: 'uppercase' }}>
            Template Preview · /preview/template/{id}
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 600 }}>{entry.label}</h1>
        </div>
        <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 720 }}>
          {TEMPLATE_IDS.map((tid) => (
            <Link
              key={tid}
              href={`/preview/template/${tid}`}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid #d8d2c4',
                background: tid === id ? '#1c1b18' : '#fff',
                color: tid === id ? '#fff' : '#333',
                textDecoration: 'none',
              }}
            >
              {tid}
            </Link>
          ))}
        </nav>
      </header>
      <TemplatePreviewClient templateId={id} data={data} />
    </div>
  );
}
