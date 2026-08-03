import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 删除书页(2026-08-03 设计:docs/specs/2026-08-03-delete-page-design.md)的接线
   守卫。服务层对错在 album-service.test.ts;这里 pin 接线上的共存条件:
     · 每端恰好一个 DELETE 发射点,失败都回滚本地并提示
     · 两端都有「非内页拒绝 + 最后一张内页拒绝」双守卫(服务端之外的前置反馈)
     · 翻面提示按 spread 条件分叉(双宽页净减 2 个页位不移位,不提示)
     · 移动端删除格 = 确认弹窗,不是点了就删 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

const editor = read('EditorPort.tsx');
const mobileRoot = read('mobile', 'MobileEditorRoot.tsx');
const editView = read('mobile', 'EditView.tsx');

test('桌面:入口在选中页气泡(page 组),恰好一个 DELETE 发射点,失败回滚', () => {
  assert.match(editor, /data-edit-action="delete-page"/);
  assert.match(editor, /if \(action === 'delete-page'\)/);
  const deletes = editor.match(/method: 'DELETE'/g) ?? [];
  assert.equal(deletes.length, 1, '桌面只允许 deleteSelectedPage 一个 DELETE 发射点');
  assert.match(editor, /deletePageFailed/, '失败回滚提示');
  assert.match(editor, /deletePageAnchored/, '非内页拒绝');
  assert.match(editor, /deletePageLast/, '最后一张内页拒绝');
  assert.match(editor, /deletePageFlipNote/, '普通内页删除要带翻面提示');
});

test('移动端:确认弹窗后才删,恰好一个 DELETE 发射点,失败回滚', () => {
  // ModalHost 的 testId prop 在运行时才落成 data-testid,源码层 pin prop 本身。
  assert.match(mobileRoot, /testId="delete-page-confirm"/, '删除要过确认弹窗');
  assert.match(mobileRoot, /data-testid="delete-page-confirm-btn"/);
  const deletes = mobileRoot.match(/method: 'DELETE'/g) ?? [];
  assert.equal(deletes.length, 1, '移动端只允许 commitDeletePage 一个 DELETE 发射点');
  assert.match(mobileRoot, /页面没有删掉/, '失败回滚提示');
  assert.match(mobileRoot, /封面、目录和封底不能删除/, '非内页拒绝');
  assert.match(mobileRoot, /最后一张内页/, '最后一张内页拒绝');
  assert.match(mobileRoot, /spread/, '翻面提示按 spread 条件分叉');
  assert.match(editView, /aria-disabled/, '非内页删除格置灰(仍可点,toast 说明原因)');
});

test('两端都退出被删页的选中/编辑态(不能停留在错位引用上)', () => {
  assert.match(editor, /selectedPageIndex = null;[\s\S]{0,200}?hideElementToolbar\(\)/);
  assert.match(mobileRoot, /setEditPage\(null\);[\s\S]{0,200}?setSelection\(null\)/);
});

// 2026-08-03 线上 400 复盘:/pages/[idx] 的线上契约是页对象的 pageIndex **字段**
// (桌面 data-page-index=String(page.pageIndex)、移动端 persistPage(page.pageIndex)),
// 存量相册字段可能不连续(线上见 129/132)。删除链路必须全程按字段,不许按数组下标。
test('线上契约:两端删除都按 pageIndex 字段,不按数组下标', () => {
  // 桌面:selectedPageIndex 是字段 → 查页用 pageByIndex(字段 find),本地过滤按字段。
  assert.match(editor, /const page = pageByIndex\(idx\)/, '查页必须按字段(pageByIndex)');
  assert.match(editor, /prev\.filter\(\(p\) => p\.pageIndex !== idx\)/, '乐观删除必须按字段过滤');
  // 移动端:editPage 是数组下标,发线前必须换成页对象的字段。
  assert.match(mobileRoot, /const wireIndex = prev\[pageIndex\]\?\.pageIndex/, '发线前按数组下标取字段');
  assert.match(mobileRoot, /pages\/\$\{wireIndex\}/, 'URL 用字段值');
  assert.doesNotMatch(mobileRoot, /pages\/\$\{pageIndex\}`, \{ method: 'DELETE' \}/, '不许把数组下标发上线');
});
