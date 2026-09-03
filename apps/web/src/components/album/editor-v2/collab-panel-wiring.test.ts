import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* CollabPanel 接线守卫。
   背景(2026-08-28 线上实测):aT 裸赋值 `boundPick(locale)` 每次渲染返回新引用,
   refresh useCallback 随之重建,useEffect [refresh] 无限重触发 → /members 请求
   风暴,面板打开即把浏览器 fetch 打到 ERR_INSUFFICIENT_RESOURCES。此文件钉住
   修复形状,防止后续改动回归。 */

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, 'CollabPanel.tsx'), 'utf8');

test('aT 必须 useMemo 包裹(boundPick 每次调用返回新引用)', () => {
  assert.match(panel, /const aT = useMemo\(\(\) => boundPick\(locale/);
});

test('不得残留裸 aT 赋值(会重建 refresh 依赖造成请求风暴)', () => {
  assert.doesNotMatch(panel, /const aT = boundPick\(/);
});

test('refresh 的 effect 依赖形状保持 [refresh](由上两条共同保证稳定)', () => {
  assert.match(panel, /const refresh = useCallback\(async/);
  assert.match(panel, /}, \[albumId, aT\]\)/);
  assert.match(panel, /useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\)/);
});
