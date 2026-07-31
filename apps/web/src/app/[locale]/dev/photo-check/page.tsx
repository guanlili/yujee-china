'use client';

// 开发用本地照片自查页。不链入导航,直接访问 /zh/dev/photo-check?album=<uuid>。
//
// 为什么需要它:原图只存浏览器本地(架构不变量 1),服务端拿不到任何证据。相册可以
// 完美生成却一张图都不显示 —— 上传口的 photoStore.put 失败被 console.warn 吞掉,
// 建册用的是内存里的 base64,照样跑通。真机 iOS 上又没法轻易看控制台。
// 于是把每一层的真相直接打在页面上:draft 里的 photoId → IndexedDB 有没有原图 →
// getTierUrl 能不能出 URL。三层里哪一层断,一眼看得出。

import { useCallback, useEffect, useState } from 'react';
import { photoStore } from '@/lib/photo/store';
// 直接导入今天新增的常量:浏览器里显示成什么值,就是它实际加载到的代码。
// 这比看部署面板可靠 —— 面板绿灯只说明服务端发了新包,说明不了这台设备在跑什么。
import { EDGE_FLIP_MS, FLIP_EASE } from '@/components/album/editor-v2/mobile/flip';
import { resolveDeviceMode } from '@/components/album/editor-v2/mobile-canvas';

type Row = {
  photoId: string;
  original: string;
  tier: string;
  ok: boolean;
};

type Summary = {
  origin: string;
  secureContext: string;
  randomUUID: string;
  代码版本_EDGE_FLIP_MS: string;
  代码版本_FLIP_EASE: string;
  视口宽度_innerWidth: string;
  设备判定_deviceMode: string;
  请求桌面网站嫌疑: string;
  userAgent: string;
  idbOpen: string;
  idbTotalKeys: string;
  draftPhotoIds: number;
};

export default function PhotoCheckPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [note, setNote] = useState<string>('');

  const run = useCallback(async () => {
    setRows(null);
    setNote('');

    const params = new URLSearchParams(window.location.search);
    const albumId = params.get('album') ?? '';

    // ── 环境层:iOS 上非 secure context 连 crypto.randomUUID 都没有,上传第一行就抛。
    const width = window.innerWidth;
    const device = resolveDeviceMode(width);
    const env: Summary = {
      origin: window.location.origin,
      secureContext: String(window.isSecureContext),
      randomUUID: typeof crypto?.randomUUID === 'function' ? 'available' : 'MISSING',
      // 这两行是「这台设备到底加载了哪份代码」的直接证据。期望值见常量定义。
      代码版本_EDGE_FLIP_MS: `${EDGE_FLIP_MS} (期望 700)`,
      代码版本_FLIP_EASE: `${FLIP_EASE}`,
      视口宽度_innerWidth: `${width}px (screen ${window.screen?.width ?? '?'}px, dpr ${window.devicePixelRatio})`,
      // ≤767 才会挂今天那套移动画板;判成 desktop 就会看到上一代的桌面壳。
      设备判定_deviceMode: device === 'mobile' ? 'mobile ✓' : `${device} ← 不会挂移动画板`,
      // iOS Safari 的「请求桌面网站」会把视口撑到 ~980,是最常见的元凶。
      请求桌面网站嫌疑:
        /iPhone|iPod/.test(navigator.userAgent) && width > 767
          ? '高度可疑:iPhone 却报出桌面级宽度 → 去 aA 菜单关掉「请求桌面网站」'
          : /iPad/.test(navigator.userAgent) && width > 767
            ? 'iPad 宽屏,按桌面渲染属正常'
            : '无',
      userAgent: navigator.userAgent,
      idbOpen: '…',
      idbTotalKeys: '…',
      draftPhotoIds: 0,
    };

    // ── 存储层:直接开库数键,绕过所有业务逻辑。
    let allKeys: string[] = [];
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('yujee-photos');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      env.idbOpen = `ok (version ${db.version}, stores: ${[...db.objectStoreNames].join('/')})`;
      allKeys = await new Promise<string[]>((resolve, reject) => {
        const req = db.transaction('originals', 'readonly').objectStore('originals').getAllKeys();
        req.onsuccess = () => resolve(req.result.map(String));
        req.onerror = () => reject(req.error);
      });
      env.idbTotalKeys = String(allKeys.length);
      db.close();
    } catch (e) {
      env.idbOpen = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
      env.idbTotalKeys = 'n/a';
    }

    // ── 数据层:相册草稿里到底引用了哪些 photoId。
    let photoIds: string[] = [];
    if (albumId) {
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/draft`);
        const json = await res.json();
        const pages = json?.data?.draft?.pages ?? json?.draft?.pages ?? [];
        const set = new Set<string>();
        for (const p of pages) for (const v of Object.values(p.imagesJson ?? {})) if (v) set.add(String(v));
        photoIds = [...set];
      } catch (e) {
        setNote(`读取 draft 失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (photoIds.length === 0) {
      photoIds = allKeys.slice(0, 30);
      if (!albumId) setNote('没带 ?album=<uuid>,改为列出 IndexedDB 里现存的照片。');
    }
    env.draftPhotoIds = photoIds.length;
    setSummary(env);

    // ── 解析层:逐张走真实的取图链路,把异常原文打出来。
    const out: Row[] = [];
    for (const photoId of photoIds) {
      let original = '—';
      let tier = '—';
      let ok = false;
      try {
        const blob = await photoStore.getBlob(photoId);
        original = blob ? `${(blob.size / 1024).toFixed(0)} KB · ${blob.type || '(无 type)'}` : 'NOT IN INDEXEDDB';
      } catch (e) {
        original = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        const url = await photoStore.getTierUrl(photoId, 'display');
        tier = url ? `ok (${url.slice(0, 24)}…)` : 'undefined';
        ok = !!url;
      } catch (e) {
        tier = `THREW: ${e instanceof Error ? e.message : String(e)}`;
      }
      out.push({ photoId, original, tier, ok });
    }
    setRows(out);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div style={{ padding: 20, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>本地照片自查</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        用法:<code>/zh/dev/photo-check?album=&lt;相册 uuid&gt;</code>。必须在**上传照片的那台设备、那个浏览器**上打开。
      </p>

      <button
        type="button"
        onClick={() => void run()}
        style={{ marginBottom: 16, padding: '6px 14px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer' }}
      >
        重新检查
      </button>

      {note && <p style={{ color: '#b45309', marginBottom: 12 }}>{note}</p>}

      {summary && (
        <table style={{ borderCollapse: 'collapse', marginBottom: 20 }}>
          <tbody>
            {Object.entries(summary).map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '2px 14px 2px 0', color: '#666', whiteSpace: 'nowrap' }}>{k}</td>
                <td style={{ padding: '2px 0', fontWeight: String(v).includes('MISSING') || String(v).includes('FAILED') ? 700 : 400, color: String(v).includes('MISSING') || String(v).includes('FAILED') ? '#dc2626' : '#111' }}>
                  {String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows === null ? (
        <p>检查中…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#dc2626', fontWeight: 700 }}>IndexedDB 里一张照片都没有,草稿也没读到 photoId。</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '6px 12px 6px 0' }}>photoId</th>
              <th style={{ padding: '6px 12px 6px 0' }}>IndexedDB 原图</th>
              <th style={{ padding: '6px 0' }}>getTierUrl(display)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.photoId} style={{ borderBottom: '1px solid #f0f0f0', color: r.ok ? '#111' : '#dc2626' }}>
                <td style={{ padding: '5px 12px 5px 0', whiteSpace: 'nowrap' }}>{r.photoId.slice(0, 8)}…</td>
                <td style={{ padding: '5px 12px 5px 0' }}>{r.original}</td>
                <td style={{ padding: '5px 0' }}>{r.tier}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
