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

/**
 * “太花/太吵”原先挤在同一行、指向两个风格（素白散文 或 杂志刊头），模型只能抛硬币。
 * 评审要求拆成两条各自唯一的判据：颜色太多/太花 → 素白散文；太吵/太跳/太闹(信息密度太满) → 杂志刊头。
 * 文件版与内置兜底版（skills.ts）都要同步，两份给出的判断不能不一致。
 */
function assertUnambiguousNoisyMapping(body: string) {
  const lines = body.split('\n');
  const messyLine = lines.find((l) => l.includes('颜色太多') || l.includes('太花'));
  assert.ok(messyLine, '找不到「太花/颜色太多」这一行');
  assert.ok(messyLine!.includes('素白散文'), '「太花/颜色太多」应唯一指向素白散文');
  assert.ok(!messyLine!.includes('杂志刊头'), '「太花/颜色太多」这一行不该再兼指杂志刊头');

  const noisyLine = lines.find((l) => l.includes('太吵'));
  assert.ok(noisyLine, '找不到「太吵」这一行');
  assert.ok(noisyLine!.includes('杂志刊头'), '「太吵」应唯一指向杂志刊头');
  assert.ok(!noisyLine!.includes('素白散文'), '「太吵」这一行不该再兼指素白散文');
}

test('映射表消歧：太花/颜色太多唯一指向素白散文，太吵/太跳/太闹唯一指向杂志刊头（文件版）', () => {
  const body = stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content);
  assertUnambiguousNoisyMapping(body);
});

test('映射表消歧：内置兜底版本与文件版判断一致，不能各说各话', () => {
  const body = createDefaultAlbumSkills().find((s) => s.name === '风格理解')!.content;
  assertUnambiguousNoisyMapping(body);
});

/**
 * 最终评审 Important 3:多巴胺书每页底色不同,`set_text_colors` 在上面永远调不动
 * (浅底页要深字、深底页要浅字,没有哪个 hex 能同时过 4.5:1)。而「相册配色」和
 * 「风格理解」两个技能都还在往这个工具身上指 —— 模型会反复撞墙。两个技能里都要
 * 写明这条,并指向真正走得通的两个工具。
 *
 * 文件版与内置兜底版(skills.ts)的实质内容必须同步:生产加载的是文件版,skills/
 * 目录缺失时兜底的是内置版,两份给出的判断不能各说各话。
 */
function assertDopamineTextColorCaveat(body: string, where: string) {
  const caveat = body
    .split('\n')
    .find((l) => l.includes('set_text_colors') && l.includes('多巴胺') && /用不了|做不到/.test(l));
  assert.ok(caveat, `${where}:没写明「多巴胺这种每页底色不同的书用不了 set_text_colors」`);
  assert.ok(/底色/.test(caveat!), `${where}:要说清原因是每页底色不同,不能只说"用不了"`);
  // 光说不能用没有用,得给出路 —— 两条都要在技能里出现。
  assert.ok(body.includes('apply_book_style'), `${where}:缺「改整体气质」这条出路`);
  assert.ok(body.includes('set_page_background'), `${where}:缺「改某几页观感」这条出路`);
}

test('相册配色技能写明:多巴胺书上 set_text_colors 用不了,并给出两条出路（文件版）', () => {
  const skill = loadAlbumSkills().find((s) => s.name === '相册配色');
  assert.ok(skill, '相册配色技能必须能加载');
  assertDopamineTextColorCaveat(stripFences(skill!.content), '相册配色·文件版');
});

test('相册配色技能:内置兜底版与文件版判断一致', () => {
  const skill = createDefaultAlbumSkills().find((s) => s.name === '相册配色')!;
  assertDopamineTextColorCaveat(skill.content, '相册配色·内置版');
});

test('风格理解技能同样写明这条（文件版 + 内置兜底版)', () => {
  assertDopamineTextColorCaveat(
    stripFences(loadAlbumSkills().find((s) => s.name === '风格理解')!.content),
    '风格理解·文件版',
  );
  assertDopamineTextColorCaveat(
    createDefaultAlbumSkills().find((s) => s.name === '风格理解')!.content,
    '风格理解·内置版',
  );
});
