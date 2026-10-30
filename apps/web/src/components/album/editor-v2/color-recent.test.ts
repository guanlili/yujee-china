import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  RECENT_COLORS_KEY,
  RECENT_COLORS_MAX,
  loadRecentColors,
  pushRecentColor,
  saveRecentColor,
} from './color-recent';

// Fill 取色器「最近使用」(2026-08-03 用户拍板):预设一排下方多一排最近色,
// 打开面板默认拾色器模式。列表逻辑是纯函数直测;EditorPort 的接线(记账时机/
// 默认模式)沿本目录惯例用源文本断言钉住。

test('pushRecentColor:最新在前、去重提前、封顶 6 个、归一化小写', () => {
  assert.deepEqual(pushRecentColor([], '#FF0000'), ['#ff0000']);
  // 重复选择提到最前,不重复占位。
  assert.deepEqual(pushRecentColor(['#ff0000', '#00ff00'], '#00FF00'), ['#00ff00', '#ff0000']);
  // 封顶:第 7 个进来,最老的挤出去。
  const six = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
  assert.deepEqual(pushRecentColor(six, '#777777'), ['#777777', ...six.slice(0, RECENT_COLORS_MAX - 1)]);
  // 空串/空白不记。
  assert.deepEqual(pushRecentColor(['#ff0000'], '  '), ['#ff0000']);
  // rgba(带透明度)原样归一化存储。
  assert.deepEqual(pushRecentColor([], 'rgba(255, 0, 0, 0.5)'), ['rgba(255, 0, 0, 0.5)']);
});

test('load/save:localStorage 可用时往返一致,坏数据/不可用回空不抛', (t) => {
  // node 环境没有 localStorage —— load 必须静默回空(SSR 同形)。
  assert.deepEqual(loadRecentColors(), []);
  // 装一个假 localStorage 验证往返与坏数据。
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  t.after(() => { delete (globalThis as Record<string, unknown>).localStorage; });

  assert.deepEqual(saveRecentColor('#AABBCC'), ['#aabbcc']);
  assert.deepEqual(saveRecentColor('#112233'), ['#112233', '#aabbcc']);
  assert.deepEqual(loadRecentColors(), ['#112233', '#aabbcc']);
  // 坏数据:非法 JSON / 非数组 / 混入非字符串,一律安全收敛。
  store.set(RECENT_COLORS_KEY, '{not json');
  assert.deepEqual(loadRecentColors(), []);
  store.set(RECENT_COLORS_KEY, '{"a":1}');
  assert.deepEqual(loadRecentColors(), []);
  store.set(RECENT_COLORS_KEY, JSON.stringify(['#fff', 42, null, '#000']));
  assert.deepEqual(loadRecentColors(), ['#fff', '#000']);
});

// ── EditorPort 接线(源文本断言,同 design-turn-ui 等惯例) ──
const here = dirname(fileURLToPath(import.meta.url));
const port = readFileSync(join(here, 'EditorPort.tsx'), 'utf8') + '\n\n' + readFileSync(join(here, 'EditorBook.tsx'), 'utf8');

test('打开 Fill 面板默认拾色器模式:三个入口都是 picker,grid 只能手动切', () => {
  const pickerDefaults = port.match(/dataset\.mode = 'picker'/g) ?? [];
  assert.equal(pickerDefaults.length, 3, 'buildColorPanel/toggleColorPanel/mountSharedColorPicker 三处默认都应是 picker');
  assert.doesNotMatch(port, /dataset\.mode = 'grid'/, '不许再有 grid 默认入口');
});

test('最近使用:预设一排下方渲染,只在关面板时记最终色,「无背景」不记', () => {
  // 结构:eb-recent-wrap 紧跟预设 swatch 行,行内按钮复用 data-swatch 委托。
  assert.match(port, /eb-recent-wrap/, '面板里要有最近使用容器');
  assert.match(port, /data-recent-row/, '行内容由 renderRecentRow 填');
  // 记账时机:关面板(closeEbPanels)与内联卸载(unmountSharedColorPicker)各一笔。
  const commits = port.match(/commitRecentColor\(\)/g) ?? [];
  assert.ok(commits.length >= 2, '关面板与内联卸载都要记账');
  assert.match(port, /ebColorDirty = true/, 'emitColor 置脏标记 —— 开了没选色的会话不记');
  // 「无背景」清除不算选色。
  assert.match(port, /data-color-none[^\n]*\{ ebColorDirty = false/, '无背景分支先复位脏标记再关面板');
});

test('离散点选立刻记账:面板色块与 mes 快捷色点一下就落「最近使用」,不等关面板', () => {
  // 面板内点色块(预设/格子/最近一排):记账 + 立刻刷新行 + 复位脏标记(不重复记)。
  assert.match(
    port,
    /saveRecentColor\(sw\.dataset\.swatch\); renderRecentRow\(\); ebColorDirty = false;/,
    '面板色块点选必须立刻记账并刷新最近一排',
  );
  // mes 主视图快捷色:不开 Fill 面板也要落账(只置脏标记的话永远不会被 commit)。
  assert.match(
    port,
    /saveRecentColor\(cq\); renderRecentRow\(\); ebColorDirty = false;/,
    'mes 快捷色点选必须立刻记账',
  );
});
