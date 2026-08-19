import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COLOR_PRESETS } from '../board-bg/presets';
import { BACKDROP_TONES, TEXTURE_DIRECTIONS, buildTexturePrompt } from './prompt-recipe';

// 这些断言不是形式主义:每一条都对应 2026-08-18 实测里烧掉的一批图。
// 撞红时先回去看当天的 spike 结论,再决定要不要改配方。

const EVERY_COMBO = TEXTURE_DIRECTIONS.flatMap((direction) =>
  BACKDROP_TONES.map((tone) => ({ direction, tone, prompt: buildTexturePrompt({ direction, tone: tone.id }) })),
);

test('每个方向都要求纹理铺满画面 —— 少了这句,模型会画一张纸/一块布的实物照', () => {
  for (const c of EVERY_COMBO) {
    assert.match(c.prompt, /fills the entire frame/i, `${c.direction} 少了满幅约束`);
  }
});

test('配方里不出现 book / cover 这类实物名词 —— 第一轮 8 张全废就是被这两个词带的', () => {
  for (const c of EVERY_COMBO) {
    assert.doesNotMatch(c.prompt, /\bbook\b|\bcover\b|\bproduct shot\b/i, `${c.direction} 带了实物触发词`);
  }
});

test('prompt 里绝不出现十六进制色码 —— 模型会把它当文字直接画在图上(18/18 复现)', () => {
  for (const c of EVERY_COMBO) {
    assert.doesNotMatch(c.prompt, /#\s*[0-9a-f]{3,6}\b/i, `${c.tone.id} 把色码写进了 prompt`);
  }
});

test('prompt 里不提 text / photo / portrait —— 提了模型就往图上画乱码假字', () => {
  for (const c of EVERY_COMBO) {
    assert.doesNotMatch(
      c.prompt,
      /\btext\b|\bphoto\b|\bportrait\b|\bletter|\bcaption\b|\btitle\b|\bword\b/i,
      `${c.direction}/${c.tone.id} 提到了会被画出来的东西`,
    );
  }
});

test('色彩改用自然语言描述,而且一次只描述一个色', () => {
  const prompt = buildTexturePrompt({ direction: 'linen', tone: 'mist' });
  const tone = BACKDROP_TONES.find((t) => t.id === 'mist')!;
  assert.match(prompt, new RegExp(tone.wording, 'i'));
  const others = BACKDROP_TONES.filter((t) => t.id !== 'mist');
  for (const other of others) {
    assert.doesNotMatch(prompt, new RegExp(other.wording, 'i'), `串进了 ${other.id} 的描述`);
  }
});

test('配方不使用负向词 —— Seedream 不认 no X,写了也照样画出来', () => {
  for (const c of EVERY_COMBO) {
    assert.doesNotMatch(c.prompt, /\bno\s+\w|\bwithout\b|\bavoid\b/i, `${c.direction} 用了负向词`);
  }
});

test('每个色调都锚在 COLOR_PRESETS 上,不另起一套色', () => {
  const known = new Set(COLOR_PRESETS.map((c) => c.toUpperCase()));
  for (const tone of BACKDROP_TONES) {
    assert.ok(known.has(tone.hex.toUpperCase()), `${tone.id} 的 ${tone.hex} 不在 COLOR_PRESETS 里`);
  }
});

test('未知方向直接报错,不静默出一张没人要的图', () => {
  assert.throws(() => buildTexturePrompt({ direction: 'wash' as never, tone: 'mist' }), /unknown texture direction: wash/);
});

test('未知色调直接报错', () => {
  assert.throws(() => buildTexturePrompt({ direction: 'linen', tone: 'chartreuse' as never }), /unknown tone: chartreuse/);
});
