import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), 'utf8');

test('create flows persist the analyze requestId for the later select-layout handoff', () => {
  const draftSource = source('src/lib/generation/draft.ts');
  const heroSource = source('src/components/landing/HeroComposer.tsx');
  const myAlbumsSource = source('src/app/[locale]/my-albums/page.tsx');

  assert.match(draftSource, /requestId\?: string/);
  assert.match(heroSource, /const \{ albumId, requestId \} = await submitAnalyzeV3/);
  assert.match(heroSource, /albumRecipe\.save\(albumId, \{ language: draft\.language, photoIds, requestId \}\)/);
  assert.match(myAlbumsSource, /const \{ albumId, requestId \} = await submitAnalyzeV3/);
  assert.match(myAlbumsSource, /albumRecipe\.save\(albumId, \{ language, photoIds, requestId \}\)/);
});

test('editor triggers select-layout after story collection (not the poll on progress=50)', () => {
  // 时序反转:analyze 完成(progress=50)不再自动排版。收集完所有章故事后,由编辑器
  // triggerSelectLayout 手动触发 select-layout(排版时 judge_layout 拿 chapterContext 写全部文案)。
  const pollSource = source('src/lib/hooks/use-album-poll.ts');
  const editorSource = source('src/components/album/editor-v2/EditorPort.tsx');

  // poll 不再在 progress=50 自动派 select-layout。
  assert.doesNotMatch(pollSource, /submitSelectLayoutV3/, 'poll must not auto-dispatch select-layout at progress=50');

  // 触发点搬到编辑器对话面板:收集完 → triggerSelectLayout → submitSelectLayoutV3。
  // 对话/采访逻辑已从 EditorPort 抽到 ChatPanel,所以断言在两文件合并源码里找。
  const chatSource = editorSource + '\n\n' + source('src/components/album/editor-v2/ChatPanel.tsx');
  assert.match(chatSource, /async function triggerSelectLayout\(/);
  assert.match(chatSource, /albumRecipe\.load\(albumId\)/);
  assert.match(chatSource, /selectLayoutRefsFromStore\(/);
  assert.match(chatSource, /submitSelectLayoutV3\(albumId,/);
});

test('select-layout submit returns before rebuilding refs once handoff is reserved', () => {
  const serviceSource = source('src/services/generation/generation-service.ts');
  const progressCheck = serviceSource.indexOf('if (job.progress !== 50)');
  const payloadBuild = serviceSource.indexOf('const payload = buildSelectLayoutRequestFromTree');

  assert.ok(progressCheck > 0, 'submitSelectLayoutV3 must check the reservation marker');
  assert.ok(payloadBuild > 0, 'submitSelectLayoutV3 must still build the payload for first handoff');
  assert.ok(
    progressCheck < payloadBuild,
    'idempotent reserved handoffs must return before rebuilding/validating refs',
  );
});
