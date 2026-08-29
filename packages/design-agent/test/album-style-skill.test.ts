import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOK_STYLES } from '@yujee/contracts/design';
import { loadAlbumSkills } from '../src/core/album/skills-loader.ts';
import { createDefaultAlbumSkills } from '../src/core/album/skills.ts';
import { composeChatTurn } from '../src/web/album-server.ts';
import { buildAlbumSystemPrompt } from '../src/core/album/system-prompt.ts';

/** 源码/文档正则断言前必须剥注释和代码块，否则注释里出现关键词就能把断言喂饱。 */
function stripFences(md: string): string {
  return md.replace(/```[\s\S]*?```/g, '');
}

test('风格理解技能被加载，且四个风格的名字都在里面', () => {
  const skill = loadAlbumSkills().find((s) => s.name === '风格理解');
  assert.ok(skill, '风格理解技能必须能加载');
  const body = stripFences(skill!.content);
  for (const style of BOOK_STYLES) {
    assert.ok(body.includes(style.name), `技能里缺「${style.name}」`);
    assert.ok(body.includes(style.id), `技能里缺 id ${style.id}`);
  }
});

test('技能给出形容词到风格的映射，覆盖两个方向的词', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  for (const word of ['太素', '太花', '文艺', '活泼', '像杂志', '旅行']) {
    assert.ok(body.includes(word), `映射表里缺「${word}」`);
  }
});

test('技能指向两个新工具，并写明换风格的代价', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  assert.ok(body.includes('apply_book_style'));
  assert.ok(body.includes('set_page_background'));
  assert.ok(body.includes('封面文案'), '必须写明换风格会重排封面文案');
});

test('技能写了反例：单页不满意不要整本换风格', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  assert.match(body, /不要整本换风格|不是风格问题/);
});

test('内置默认技能与文件化技能同名（skills 目录缺失时的兜底不能少这一个）', () => {
  assert.ok(createDefaultAlbumSkills().some((s) => s.name === '风格理解'));
});

test('书级简报带出当前风格名', () => {
  const turn = composeChatTurn('这本书太素了', undefined, undefined, undefined, '素白散文');
  assert.match(turn, /当前风格[:：]素白散文/);
  assert.ok(turn.includes('这本书太素了'));
});

test('没有风格名时简报不多出空行（老调用零影响）', () => {
  assert.equal(composeChatTurn('你好', undefined), '你好');
});

test('system prompt 把风格级不满分流到风格理解技能', () => {
  // 照抄 album-system-prompt.test.ts 的 promptOf()
  const prompt = buildAlbumSystemPrompt({
    activeTools: [],
    resources: { skills: [], promptTemplates: [] },
  } as never);
  assert.match(prompt, /风格理解/);
  assert.match(prompt, /整本/);
  // 单页那条不能被顺手删掉 —— 它管的是另一半场景
  assert.match(prompt, /这页不好看/);
});
