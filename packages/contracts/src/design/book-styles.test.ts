import assert from 'node:assert/strict';
import test from 'node:test';

import { BOOK_STYLES, bookStyleById, bookStyleOf, styleBackgroundOptions } from './book-styles';
import { contrastRatio, deltaE } from './contrast';
import { THIRD_SET_INK, THIRD_SET_INTERIOR } from './third-set-palette';

test('四个风格，id 与封面模板一一对应', () => {
  assert.deepEqual(
    BOOK_STYLES.map((s) => [s.id, s.coverTemplateId, s.endingTemplateId]),
    [
      ['editorial', 'mag-01', 'mag-22'],
      ['magazine', 'mag-23', 'mag-22'],
      ['dopamine', 'mag-62', 'mag-63'],
      ['postcard', 'p01', 'mag-22'],
    ],
  );
});

test('非多巴胺风格的三个字色在自己底色上都过 4.5:1', () => {
  for (const style of BOOK_STYLES) {
    if (style.id === 'dopamine') continue;
    const bg = style.pageBackground;
    for (const [role, color] of Object.entries(style.colors)) {
      const ratio = contrastRatio(bg, color);
      assert.ok(ratio >= 4.5, `${style.id} 的 ${role} ${color} 落在 ${bg} 上只有 ${ratio.toFixed(2)}:1`);
    }
  }
});

test('三张白被拉开：任意两个非多巴胺底色肉眼明显可分（ΔE >= 5）', () => {
  // 换表前四套配的是 #FFFFFF/#FBF8F1/#F1F2F0/#ECEDEE，肉眼分不出，等于没有风格。
  //
  // 判据必须用色差 ΔE，不能用对比度：对比度只看亮度，看不见色相。冷灰 #E7EAE9 和
  // 暖砂 #F1E7D5 的对比度只有 1.01（三对里垫底），ΔE 却有 9.97（三对里最容易分的）。
  // 2026-08-29 实测三对：editorial↔magazine 6.37、editorial↔postcard 8.46、
  // magazine↔postcard 9.97。ΔE>5 = 明显可分。
  const bgs = BOOK_STYLES.filter((s) => s.id !== 'dopamine').map((s) => s.pageBackground);
  for (let i = 0; i < bgs.length; i += 1) {
    for (let j = i + 1; j < bgs.length; j += 1) {
      const diff = deltaE(bgs[i]!, bgs[j]!);
      assert.ok(diff >= 5, `${bgs[i]} 与 ${bgs[j]} 色差只有 ${diff.toFixed(2)}，肉眼分不出`);
    }
  }
});

test('多巴胺风格引用第三套五色，不另立一份色表', () => {
  const dopamine = bookStyleById('dopamine')!;
  assert.equal(dopamine.interiorInks, THIRD_SET_INTERIOR);
  assert.equal(dopamine.pageBackground, THIRD_SET_INTERIOR[0]!.bg);
});

test('多巴胺五色各自配的字色都过 4.5:1', () => {
  for (const ink of THIRD_SET_INTERIOR) {
    const ratio = contrastRatio(ink.bg, ink.body);
    assert.ok(ratio >= 4.5, `${ink.id} ${ink.bg} 配 ${ink.body} 只有 ${ratio.toFixed(2)}:1`);
    assert.ok(ink.body === THIRD_SET_INK.light || ink.body === THIRD_SET_INK.dark, '字色必须是两色之一');
  }
});

test('bookStyleOf 从封面模板反推风格', () => {
  assert.equal(bookStyleOf('mag-62').id, 'dopamine');
  assert.equal(bookStyleOf('mag-01').id, 'editorial');
  assert.equal(bookStyleOf('mag-23').id, 'magazine');
  assert.equal(bookStyleOf('p01').id, 'postcard');
});

test('表外封面回落 editorial（不抛错：老书/手工换过封面的书也要有风格）', () => {
  assert.equal(bookStyleOf('mag-32').id, 'editorial');
  assert.equal(bookStyleOf('').id, 'editorial');
});

test('多巴胺的底色选项是五色 id，其余风格是主底色 + 四白', () => {
  assert.deepEqual(
    styleBackgroundOptions('dopamine').map((o) => o.id),
    ['butter', 'violet', 'orange', 'green', 'blue'],
  );
  const editorial = styleBackgroundOptions('editorial');
  assert.equal(editorial[0]!.hex, '#FBF8F1');
  assert.deepEqual(editorial.map((o) => o.id).slice(1), ['white', 'ivory', 'mist', 'ash']);
});

test('多巴胺底色选项的 name 是中文，不是内部 id（模型转述给用户不能带英文标识）', () => {
  // DarkInk 类型本身没有中文展示名字段，name 曾直接回落成 id（"butter"），
  // 导致 apply_book_style / set_page_background 的 notes 拼出「刷成butter」这种
  // 中英混杂句子。styleBackgroundOptions 必须把这五个 id 映射成中文。
  assert.deepEqual(
    styleBackgroundOptions('dopamine').map((o) => o.name),
    ['淡黄', '紫', '橙', '绿', '蓝'],
  );
});
