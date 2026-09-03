import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(join(here, 'album-service.ts'), 'utf8');

/**
 * 协同授权 seam(collab plan §5.1):owner|editor 都算作者,**所有作者读写路径**
 * 必须走 collaborationService.requireAccess,不能再用只认 owner 的 findOwned。
 *
 * 这条钉的是一次真实事故:getDetail 当初专门从 findOwned 迁到了 requireAccess
 * (它自己的注释写着「若仍走 findOwned,editor 会在加载 draft 之前就收到 403」),
 * 但 getStoryProgress 漏了。后果不是报错,是**导出按钮永久点不动**:
 *   协作者打开共享相册 → getDetail 放行、编辑器正常加载
 *   → ChatPanel 拉 /story-progress → findOwned 抛 ALBUM_NOT_OWNED 403
 *   → ChatPanel 的 catch 静默吞掉,storyProgress = null
 *   → isAuthoringExportLocked(null) 返回 true,按钮 disabled
 * 用户看到的是「点不动、没提示、没进度」,日志里一个字都没有。
 */
/**
 * 源码正则守卫的第一条纪律:**断言前必须剥注释**。
 * 不剥的话,一句 `// 本来该走 collaborationService.requireAccess(...)` 就能喂饱
 * assert.match —— 实现改回 owner-only 裸检查,守卫照样绿。这不是理论风险,是
 * 本文件被 mutation 实测出来的:2026-09-02 code review 把 getStoryProgress 改回
 * findOwned 式裸检查、只留一行注释,原版守卫 pass 3 / fail 0。
 *
 * 改动本文件的任何断言后,都必须重跑一次 mutation(把被钉的实现真的改坏,确认
 * 守卫变红)才能提交。绿不是证据。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function bodyOf(name: string): string {
  const at = service.indexOf(`  async ${name}(`);
  assert.ok(at >= 0, `album-service 里找不到 ${name}`);
  // 到下一个顶层 async 方法为止 —— 够覆盖方法体,不必真的配对花括号。
  const next = service.indexOf('\n  async ', at + 10);
  return stripComments(service.slice(at, next === -1 ? service.length : next));
}

// 作者侧的读路径:协作者(editor)必须能读,否则编辑器会带着半个状态开着。
for (const name of ['getStoryProgress', 'listCoverSets']) {
  test(`${name} 走协同授权 seam,而不是只认 owner 的 findOwned`, () => {
    const body = bodyOf(name);
    assert.doesNotMatch(
      body,
      /this\.findOwned\(/,
      `${name} 仍在用 findOwned:协作者会拿到 403,而前端把它静默吞成「闸门未知」→ 导出按钮永久 disabled`,
    );
    assert.match(
      body,
      /collaborationService\.requireAccess\(/,
      `${name} 应当经 requireAccess 判权(owner|editor 都是作者)`,
    );
  });
}

test('前端拉闸门失败时不再静默:失败要落日志,否则「按钮点不动」查无实据', () => {
  const chat = readFileSync(join(here, '..', '..', 'components', 'album', 'editor-v2', 'ChatPanel.tsx'), 'utf8');
  const at = chat.indexOf('async function loadStoryGate()');
  assert.ok(at >= 0, 'ChatPanel 里找不到 loadStoryGate');
  // 切到下一个函数定义为止,不用固定字符窗口 —— 固定 900 的原版只剩 247 字符
  // 余量,函数里多写两行注释 catch 就滑出窗口,doesNotMatch 无条件通过。
  const rest = chat.slice(at + 10);
  const next = rest.search(/\n\s*(async )?function \w+/);
  const body = stripComments(next === -1 ? rest : rest.slice(0, next));
  assert.doesNotMatch(
    body,
    /\}\s*catch\s*\{\s*storyGate = null;/,
    'loadStoryGate 的 catch 不能是空的:闸门拉不到会让导出按钮永久 disabled,必须留下日志',
  );
});
