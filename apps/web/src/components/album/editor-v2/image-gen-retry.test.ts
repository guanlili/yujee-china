import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* AI 生图「免费重来」不因关窗作废(2026-08-21)。
   用户为一次生成付过 1 积分,附赠 1 次免费重来,次数记在 imageGenState 里。原来
   closeImageGen 直接把它置 null —— 点 ×/取消/背景/按 Esc 任一个,已付费的重来权益
   当场蒸发,而弹窗自己还写着「不满意可以免费再来一张」。
   现在:关窗只收 UI;状态按图槽(pageIndex:slotId)保留,换槽再开才丢弃。
   仍只在内存里,刷新页面会丢 —— 要彻底得落库,尚未做。 */

const here = dirname(fileURLToPath(import.meta.url));
const editor = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');
// 断言只看代码:注释里出现某个标识符不能算它「接线了」(这批测试踩过这个坑)。
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const fn = (name: string) => {
  const m = editor.match(new RegExp(`function ${name}\\(\\)[\\s\\S]*?\\n    \\}`));
  return stripComments(m?.[0] ?? '');
};

test('closeImageGen 不许再清空 imageGenState', () => {
  const code = fn('closeImageGen');
  assert.ok(code, 'closeImageGen 应存在');
  assert.match(code, /classList\.remove\('open'\)/, '仍要收起弹窗');
  assert.doesNotMatch(
    code,
    /imageGenState = null/,
    '关窗清空 = 用户误关一次就白付 1 积分;换槽丢弃由 openImageGen 负责',
  );
});

test('openImageGen 按图槽决定保留还是丢弃,并把剩余次数显示出来', () => {
  const code = fn('openImageGen');
  assert.ok(code, 'openImageGen 应存在');
  // 槽位键必须同时含页码和槽 id:只按 slotId 会让不同页的同名槽互相串用免费次数。
  assert.match(code, /imgEdit\.pageIndex/, '槽位键要含 pageIndex');
  assert.match(code, /imgEdit\.slotId/, '槽位键要含 slotId');
  assert.match(code, /imageGenState\?\.slotKey !== \w+/, '槽位不匹配才丢弃状态');
  assert.match(code, /imageGenState = null/, '换到别的图槽必须丢弃');
  // 重开时按钮和提示要如实反映「还有免费次数」,否则用户以为没了、干脆不点。
  // 钉住它真的从状态里读:写成 const freeRetriesLeft = 0 的话标识符还在,只匹配名字
  // 会被喂饱(实测漏过一次)。
  assert.match(
    code,
    /freeRetriesLeft = imageGenState\?\.freeRetriesLeft/,
    '剩余次数必须来自 imageGenState,不能写死',
  );
  assert.match(code, /freeRetriesLeft > 0\s*\n?\s*\?/, '按剩余次数分支渲染按钮/提示');
});

test('imageGenState 带 slotKey,写入点同步', () => {
  const src = stripComments(editor);
  assert.match(src, /slotKey: string; generationId: string; freeRetriesLeft: number/, '类型要带 slotKey');
  // 不锁单行格式(Prettier 换行就假失败),只要求写回时确实带上 slotKey。
  assert.match(src, /imageGenState = \{\s*slotKey:/, '生成成功写回时必须带上 slotKey');
});
