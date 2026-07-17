import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

// 取一个 4 空格缩进的顶层内嵌函数体(effect 内的函数缩进都是 4 空格,闭合是 `\n    }`)。
function fnBody(name: string): string {
  const m = chat.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n    \\}`));
  assert.ok(m, `${name} should exist`);
  return m[0];
}

test('加图「先攒后发」:点 + 只暂存,点发送才提交排版/扣款', () => {
  // 旧的「选了就直接提交」入口必须没了
  assert.doesNotMatch(chat, /function handleAddPhotos/, 'the immediate-submit handleAddPhotos must be gone');
  // 文件选择 → 只暂存
  assert.match(chat, /void stageAddedPhotos\(files\)/, '选照片走暂存 stageAddedPhotos,不直接提交');

  // 暂存:压缩 + 原图入 IndexedDB + 渲染缩略图;绝不提交(不进排版/扣款)
  const stage = fnBody('stageAddedPhotos');
  assert.match(stage, /compressFile\(file, photoId\)/, 'stage 压缩');
  assert.match(stage, /photoStore\.put\(photoId, file\)/, 'stage 原图入 IndexedDB');
  assert.match(stage, /stagedPhotos\.push\(/, 'stage 把照片放进暂存列表');
  assert.match(stage, /renderStagedThumbs\(\)/, 'stage 渲染缩略图条');
  assert.doesNotMatch(stage, /submitAddPhotosV3/, 'stage 绝不提交(不进排版/扣款)');

  // 提交:点发送才 submitAddPhotosV3 → 采访/排版轮询,提交后清空暂存
  const submit = fnBody('submitStagedPhotos');
  assert.match(submit, /submitAddPhotosV3\(albumId/, 'submit 才提交进排版');
  assert.match(submit, /withWorkflowBusy\(\(\) => waitForAppendChapters/, 'submit 才进采访/排版轮询(且计入 workflowBusy)');
  assert.match(submit, /stagedPhotos = \[\];/, 'submit 后清空暂存条');

  // send 有暂存照片就把它们提交出去(HeroComposer 同款);全程包 withWorkflowBusy,
  // 提交/分析期间发送键一直禁用(不留空档)。
  assert.match(
    chat,
    /if \(stagedPhotos\.length > 0\) \{[\s\S]*?void withWorkflowBusy\(\(\) => submitStagedPhotos\(\)\);/,
    'send 有暂存照片时提交它们(全程 workflowBusy)',
  );

  // × 可移除(关掉不发送);输入框内有暂存缩略图容器
  assert.match(chat, /stagedPhotos = stagedPhotos\.filter\(\(s\) => s\.photoId !== p\.photoId\)/, '× 从暂存里移除该照片(不发送)');
  assert.match(chat, /id="stagedPhotos"/, '输入框内有暂存缩略图容器');
});
