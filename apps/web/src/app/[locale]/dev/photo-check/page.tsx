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
  const [writeProbe, setWriteProbe] = useState<string[]>([]);

  // 写入自测:两个上传口都把 photoStore.put 的失败 console.warn 掉了,iOS 上看不到。
  // 这里当场跑一次真实写入 + 读回,把异常的 name/message 原样打在屏幕上 —— 这是
  // 「originals 表为什么是空的」唯一能在真机上取到的直接证据。
  // 同时用一条「裸 IndexedDB 写入」做对照:若裸写成功而 photoStore.put 失败,
  // 问题就锁死在 store.ts 的事务用法上,而不是 Safari 不让写。
  const probeWrite = useCallback(async () => {
    // 立刻给一行反馈:否则「没点着」和「跑了但失败」在屏幕上长得一模一样。
    setWriteProbe(['运行中…']);
    const log: string[] = [];
    const id = `diag-${Date.now()}`;
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });

    // A:走真实的 photoStore.put(上传口用的就是它)
    try {
      await photoStore.put(id, blob);
      const back = await photoStore.getBlob(id);
      log.push(back ? `A. photoStore.put → 成功,读回 ${back.size} 字节` : 'A. photoStore.put 未报错,但读回是 undefined');
    } catch (e) {
      const err = e as { name?: string; message?: string };
      log.push(`A. photoStore.put → 失败: ${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`);
    }

    // B:对照组 —— 事务创建后立刻发请求,中间不跨 await
    try {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('yujee-photos', 2);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const t = db.transaction('originals', 'readwrite');
        const req = t.objectStore('originals').put(blob, `${id}-raw`);
        req.onsuccess = () => res();
        req.onerror = () => rej(req.error);
        t.onabort = () => rej(t.error ?? new Error('transaction aborted'));
      });
      db.close();
      log.push('B. 裸 IndexedDB 写入(不跨 await) → 成功');
    } catch (e) {
      const err = e as { name?: string; message?: string };
      log.push(`B. 裸 IndexedDB 写入 → 失败: ${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`);
    }

    // C:配额,Safari 会按站点配额直接拒绝写入
    try {
      const est = await navigator.storage?.estimate?.();
      log.push(
        est
          ? `C. 存储配额: 已用 ${((est.usage ?? 0) / 1048576).toFixed(1)} MB / 上限 ${((est.quota ?? 0) / 1048576).toFixed(0)} MB`
          : 'C. 该浏览器不支持 storage.estimate()',
      );
      const persisted = await navigator.storage?.persisted?.();
      log.push(`C. 持久化存储: ${persisted ? '已授予' : '未授予(Safari 可能按需清理)'}`);
    } catch {
      log.push('C. 配额查询失败');
    }

    setWriteProbe(log);
    void run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // iPhone 上内容顶到屏幕最上沿会被灵动岛/状态栏盖住,盖住的那块点不到 ——
    // 按钮排在页首时会表现成「点了没反应」。留出安全区。
    <div
      style={{
        padding: 20,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 72px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>本地照片自查</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>
        用法:<code>/zh/dev/photo-check?album=&lt;相册 uuid&gt;</code>。必须在**上传照片的那台设备、那个浏览器**上打开。
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void run()}
          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer' }}
        >
          重新检查
        </button>
        <button
          type="button"
          onClick={() => void probeWrite()}
          style={{
            padding: '16px 28px',
            borderRadius: 10,
            border: '1px solid #111',
            background: '#111',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            flex: '1 1 auto',
            minWidth: 180,
          }}
        >
          ▶ 写入自测（点这个）
        </button>
      </div>

      {writeProbe.length > 0 && (
        <pre
          style={{
            background: '#0f172a',
            color: '#e2e8f0',
            padding: 12,
            borderRadius: 8,
            marginBottom: 20,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
          }}
        >
          {writeProbe.join('\n')}
        </pre>
      )}

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
