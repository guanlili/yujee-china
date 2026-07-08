'use client';

// 开发用模板对比测试页（HTML 化试点验收）。不链入导航，直接访问 /zh/dev/template-check。
// 左：现有 React 组件渲染；右：新 HTML 模板渲染，肉眼对比一致性。
// 底部：导出栅格 PDF（报截图像素→DPI），+ 小图/大图切换，验证"图糊=源图分辨率"而非栅格过程。
import { createElement, useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { adaptPageToTemplateData, type AdaptablePage, type ResolveImage } from '@/components/album/adapt-layout';
import { renderPageHtml } from '@/components/album/templates/html/fill-template';
import { PAGE } from '@/components/album/templates/constants';
import { getWebTemplate } from '@/components/album/web-registry';

const SMALL_IMAGE = '/samples/layouts/travel-memoir.webp'; // 637×900（小预览，scale3 会糊）
const HIRES_IMAGE = '/dev-hires-test.jpg'; // 2400×1680（够大，应清晰）

const TEXTS = {
  title: '山与海',
  label: 'On the Road · 2024',
  explain1: '一边是连绵的山，一边是无边的海，我们刚好走在中间。',
  explain2: '那天风很大，帽子被吹跑了，我们笑着追了很久，最后停在海边看夕阳。',
};

export default function TemplateCheckPage() {
  const [scale, setScale] = useState(3);
  const [hires, setHires] = useState(true);
  const [status, setStatus] = useState('');
  const htmlHostRef = useRef<HTMLDivElement>(null);

  const previewScale = 0.5;
  const imageUrl = hires ? HIRES_IMAGE : SMALL_IMAGE;

  const pageData: AdaptablePage = {
    templateId: 'mag-01',
    images: { image: 'sample' },
    texts: TEXTS,
    imagePos: { image: { x: 50, y: 45, scale: 1 } },
  };
  const resolveImage: ResolveImage = (id) => (id === 'sample' ? imageUrl : undefined);

  const reactData = adaptPageToTemplateData(pageData, resolveImage);
  const ReactTemplate = getWebTemplate('mag-01');
  const html = renderPageHtml(pageData, resolveImage);

  useEffect(() => {
    if (htmlHostRef.current && html) htmlHostRef.current.innerHTML = html;
  }, [html]);

  async function exportRasterPdf() {
    setStatus('渲染中…');
    try {
      const { renderAlbumPdfRaster } = await import('@/lib/pdf/render-raster');
      const blob = await renderAlbumPdfRaster([pageData], resolveImage, { scale });
      const capturedW = Math.round(PAGE.width * scale);
      const dpi = Math.round(capturedW / 8.27); // 794px = A4 宽 8.27in
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mag-01-${hires ? 'hires' : 'small'}-scale${scale}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus(
        `已下载。源图=${hires ? '2400×1680 大图' : '637×900 小图'}；scale=${scale} → 每页截图 ${capturedW}×${Math.round(PAGE.height * scale)}px ≈ ${dpi} DPI；PDF ${(blob.size / 1024).toFixed(0)} KB。`,
      );
    } catch (e) {
      setStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', background: '#eef1f5', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>mag-01 模板 HTML 化对比（试点验收）</h1>
      <p style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
        左＝现有 React 渲染，右＝新 HTML 渲染，应肉眼一致。下方导出栅格 PDF；切换小图/大图可验证「图糊 = 源图分辨率不够，非栅格过程」。
      </p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>React（旧）</div>
          <div style={{ width: PAGE.width * previewScale, height: PAGE.height * previewScale, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.1)' }}>
            <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', width: PAGE.width, height: PAGE.height }}>
              {ReactTemplate ? createElement(ReactTemplate, { data: reactData, totalPages: 1, imagePos: pageData.imagePos }) : null}
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>HTML（新）</div>
          <div style={{ width: PAGE.width * previewScale, height: PAGE.height * previewScale, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.1)' }}>
            <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', width: PAGE.width, height: PAGE.height }} ref={htmlHostRef} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>
          源图：
          <select value={hires ? 'hi' : 'sm'} onChange={(e) => setHires(e.target.value === 'hi')} style={{ marginLeft: 6 }}>
            <option value="hi">大图 2400×1680（应清晰）</option>
            <option value="sm">小图 637×900（会糊）</option>
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          截图倍率 scale：
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ marginLeft: 6 }}>
            <option value={2}>2（≈192 DPI）</option>
            <option value={3}>3（≈288 DPI）</option>
            <option value={4}>4（≈384 DPI）</option>
          </select>
        </label>
        <button onClick={exportRasterPdf} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
          导出栅格 PDF
        </button>
        <span style={{ fontSize: 13, color: '#333' }}>{status}</span>
      </div>

      <details style={{ marginTop: 20 }}>
        <summary style={{ fontSize: 12, color: '#888', cursor: 'pointer' }}>查看 HTML 模板填充后源码</summary>
        <pre style={{ fontSize: 11, background: '#fff', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 300 }}>
          {(html ?? '(无 HTML 模板)').concat('\n\n--- React 静态标记（对照）---\n', ReactTemplate ? renderToStaticMarkup(createElement(ReactTemplate, { data: reactData, totalPages: 1, imagePos: pageData.imagePos })) : '')}
        </pre>
      </details>
    </div>
  );
}
