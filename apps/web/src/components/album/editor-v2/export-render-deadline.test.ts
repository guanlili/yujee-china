import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 导出卡死的守卫(2026-11-09 两次线上实测得出)。
//
// 现象:点「导出整本 PDF」后进度条永远停在 0%、标签一直是「…」,十分钟不动;
// 控制台是照片/字体资源的 ERR_TIMED_OUT。用户既拿不到文件,也收不到「导出失败」,
// 因为整条渲染流水线根本没有走到它的失败分支 —— 它卡在 await 上。
//
// 根因模式:**渲染前/渲染中所有对外请求都没有截止时间**。
//   · 字体子集 POST /api/v1/fonts/subset   → 挂住则栅格化永不开始
//   · document.fonts.ready                 → 可能被别的字体拖住
//   · 备份图直拉 fetchBackupBlob           → 本地没原图时唯一的图片源
//   · 远端原图回退 fetcher                 → 同一条兜底路
// 这条测试钉死:这些点都必须有上限,且两端渲染整体都有 watchdog。

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, '..', '..', '..', '..');
function source(rel: string): string {
  return readFileSync(join(webSrc, 'src', rel), 'utf8');
}

test('字体子集请求与 fontsReady 都必须有截止时间', () => {
  const loader = source('lib/font/album-font-loader.ts');
  assert.match(loader, /FONT_SUBSET_TIMEOUT_MS\s*=\s*\d/, '字体子集请求必须有上限');
  assert.match(
    loader,
    /fetchWithTimeout\(\s*'\/api\/v1\/fonts\/subset'/,
    '字体子集必须走带截止的 fetch',
  );
  assert.match(loader, /withDeadline\([\s\S]{0,120}fontsReady/, 'document.fonts.ready 必须有上限');
});

test('备份图与远端原图回退都必须有截止时间', () => {
  const store = source('lib/photo/store.ts');
  assert.match(store, /BACKUP_SNAPSHOT_TIMEOUT_MS\s*=\s*\d/, '备份图拉取必须有上限');
  assert.match(store, /fetchWithTimeout\(\s*url,/, '备份图必须走带截止的 fetch');
  assert.match(store, /withDeadline\(fetcher\(photoId\)/, '远端原图回退必须有上限');
});

test('网络截止工具是单一实现,导出侧的 fetchWithTimeout 从它 re-export', () => {
  const net = source('lib/net/fetch-timeout.ts');
  assert.match(net, /export async function fetchWithTimeout/, '必须有一份共享实现');
  assert.match(net, /export function withDeadline/, '必须能对任意 promise 加截止');
  const retry = source('components/album/editor-v2/export-retry-util.ts');
  assert.match(
    retry,
    /export \{ fetchWithTimeout \} from '@\/lib\/net\/fetch-timeout'/,
    '导出侧必须复用共享实现,不许各写一套',
  );
});

test('两端整本渲染都有 watchdog,超时按 render 失败处理', () => {
  const raster = source('lib/pdf/render-raster.ts');
  assert.match(raster, /RASTER_PDF_RENDER_DEADLINE_MS\s*=\s*\d/, '渲染兜底期限必须集中定义');
  for (const file of ['components/album/editor-v2/EditorBook.tsx', 'components/album/editor-v2/mobile/use-export.ts']) {
    const src = source(file);
    assert.match(src, /RASTER_PDF_RENDER_DEADLINE_MS/, `${file} 必须引用渲染期限`);
    assert.match(
      src,
      /withDeadline\(\s*\(async \(\) => \{[\s\S]{0,260}renderAlbumPdfRaster/,
      `${file} 的渲染(含取图)必须整段包在 watchdog 里`,
    );
  }
});
