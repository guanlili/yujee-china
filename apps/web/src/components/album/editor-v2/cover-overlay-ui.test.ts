import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 必选封面选择卡的"盖在输入框上一层 + 缩略图放大镜气泡"结构守卫。
// 与本目录其他测试一致:读源码字符串做正则断言(仓库无 jsdom)。
const here = dirname(fileURLToPath(import.meta.url));
const chatPanel = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');

// 抓一个函数体:从 `function name(` 到最靠前的 4 空格缩进闭合 `\n    }`。
function fnBody(name: string): string {
  const re = new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n {4}\\}`);
  const m = re.exec(chatPanel);
  assert.ok(m, `${name}() 函数体必须可解析`);
  return m![0];
}

test('必选封面选择卡挂进输入框上方的覆盖层 #coverDock,而不是消息流', () => {
  assert.match(chatPanel, /id="coverDock"/, '需要静态的 #coverDock 覆盖层挂载点');
  assert.match(css, /\.cover-dock\{/, 'cover-dock 需要样式');
  const offer = fnBody('offerDesignCard');
  assert.match(offer, /dock\.replaceChildren\(inner\)/, '选择卡要挂进 coverDock');
  assert.match(offer, /dock\.style\.display = ''/, '显示覆盖层');
  assert.match(offer, /setCoverLock\(true\)/, '显示覆盖层时锁住输入');
  assert.doesNotMatch(offer, /chatBody!\.appendChild\(card\)/, '选择卡不再直接进消息流');
});

test('锁定 = 置灰输入框 + 禁用发送按钮', () => {
  const lock = fnBody('setCoverLock');
  assert.match(lock, /classList\.toggle\('cover-locked', on\)/, '切换 .cover-locked');
  // 合并 main 的送出键单一真相源后:锁定不再直接摸 send.disabled,改设 coverLocked 后走 refreshSendDisabled。
  assert.match(lock, /coverLocked = on;\s*refreshSendDisabled\(\)/, '锁定经 coverLocked 走送出键单一真相源');
  assert.match(
    css,
    /\.composer-group\.cover-locked \.chat-input\{[^}]*pointer-events:\s*none/,
    '锁定态下输入框不可交互',
  );
});

test('确认后:收覆盖层 + 解锁 + 回执卡与用户气泡进历史(回执卡在前,与回放同序)', () => {
  const run = fnBody('runApplyDesign');
  assert.match(run, /dock\.style\.display = 'none'/, '收起覆盖层');
  assert.match(run, /setCoverLock\(false\)/, '解锁输入');
  assert.match(run, /chatBody!\.appendChild\(recap\)/, '回执卡进消息流');
  assert.match(run, /appendUserText\(aT\('就用这组封面'/, '追加用户气泡');
  assert.ok(
    run.indexOf('appendChild(recap)') < run.indexOf("appendUserText(aT('就用这组封面"),
    '回执卡必须在用户气泡之前(与 loadHistory 回放顺序一致)',
  );
  // 既有守卫:失败复位并重弹选择卡
  assert.match(run, /designOfferShown = false;\s*\n\s*void offerDesignCard\(\);/);
});

test('缩略图右下角小放大镜 → 无遮罩气泡放大', () => {
  const offer = fnBody('offerDesignCard');
  assert.match(offer, /class="cv-zoom"/, '缩略图上要有小放大镜');
  assert.match(offer, /openCoverZoom\(sets\[i\]\)/, '点放大镜开气泡');
  const zoom = fnBody('openCoverZoom');
  assert.match(zoom, /cv-zoom-layer/, '气泡浮层');
  assert.match(
    zoom,
    /coverOptionHTML\?\.\(set\.coverTemplateId, set\.coverPhotoId, 132, 176, set\.pageBackground\)/,
    '放大用更大尺寸渲染封面(带每套书页底色)',
  );
  assert.match(zoom, /coverOptionHTML\?\.\(set\.endingTemplateId, set\.endingPhotoId, 132, 176, set\.pageBackground\)/, '放大封尾(带每套书页底色)');
  assert.doesNotMatch(
    css,
    /\.cv-zoom-layer\{[^}]*background:\s*rgba\(0,\s*0,\s*0/,
    '无遮罩:气泡层不能有暗色蒙版',
  );
  const close = fnBody('closeCoverZoom');
  assert.match(close, /\.cv-zoom-layer'\)\?\.remove\(\)/, '关闭时移除气泡层');
});
