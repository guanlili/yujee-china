import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { applyFolioOverlay, pageFolioInfos } from './page-html-dom';

const COVER = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.category === 'cover')!;
const SPREAD = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.spread === true);

// #303 review finding: toc/ending → folio:null 与「side 来自真实版面而非奇偶」这
// 两条不变量随 c5a605e 删掉的三个旧测试一起丢了覆盖率。派生 id 而非硬编码,理由同
// spreads.test.ts 顶部注释:模板会被重新分类,硬编码的 id 会腐烂成假前提。
const TOC_IDS = TEMPLATE_IDS.filter((id) => TEMPLATES[id]?.category === 'toc');
const ENDING_IDS = TEMPLATE_IDS.filter((id) => TEMPLATES[id]?.category === 'ending');
const INTERIOR_IDS = TEMPLATE_IDS.filter((id) => TEMPLATES[id]?.category === 'interior');
const [TOC] = TOC_IDS;
const [ENDING] = ENDING_IDS;

test('fixture premise: toc/ending/interior 模板都存在,供 folio 不变量测试使用', () => {
  assert.ok(TOC, `需要至少一个 toc 模板，当前：${TOC_IDS.join(', ') || '(无)'}`);
  assert.ok(ENDING, `需要至少一个 ending 模板，当前：${ENDING_IDS.join(', ') || '(无)'}`);
  assert.ok(
    INTERIOR_IDS.length >= 2,
    `需要至少两个 interior 模板，当前只有 ${INTERIOR_IDS.length} 个：${INTERIOR_IDS.join(', ')}`,
  );
});

test('cover carries no folio; interior numbers from 1 and sides follow the spread', () => {
  assert.deepEqual(pageFolioInfos([COVER, 'mag-03', 'mag-05']), [
    { folio: null, side: 'right' },
    { folio: 1, side: 'left' },
    { folio: 2, side: 'right' },
  ]);
});

test('a spread page eats two folio numbers and prints both sides', (t) => {
  if (!SPREAD) return t.skip('还没有 spread 模板(Task 8 会加 mag-54)');
  assert.deepEqual(pageFolioInfos([COVER, SPREAD, 'mag-03']), [
    { folio: null, side: 'right' },
    { folio: { left: 1, right: 2 }, side: 'left' },
    { folio: 3, side: 'left' },
  ]);
});

test('a dual folio injects two page numbers', () => {
  const html = '<div data-template="x"></div>';
  const out = applyFolioOverlay(html, { left: 4, right: 5 });
  assert.equal((out.match(/data-page-folio="true"/g) ?? []).length, 2);
  assert.ok(out.includes('>4</div>'));
  assert.ok(out.includes('>5</div>'));
});

test('toc and ending both carry folio:null; interior pages still number continuously from 1', () => {
  const [I1, I2] = INTERIOR_IDS;
  const infos = pageFolioInfos([COVER, TOC!, I1!, I2!, ENDING!]);
  // cover/toc/ending 三类都不编号;两张内页无视中间/结尾的 non-folio 页,连续从 1 起号。
  assert.deepEqual(infos.map((info) => info.folio), [null, null, 1, 2, null]);
});

test('side 来自 placePages 的真实版面,不是页码/下标的奇偶 —— 插一张 toc 会让后面同一张内页的 side 翻面', () => {
  const [I1, I2] = INTERIOR_IDS;
  const withoutToc = pageFolioInfos([COVER, I1!, I2!, ENDING!]);
  const withToc = pageFolioInfos([COVER, TOC!, I1!, I2!, ENDING!]);

  // 同一张内页 I1:两种版面里 folio 号都是 1(不受 toc 影响),但贴边侧别不同 ——
  // 证明 side 不能从 folio 编号或数组下标的奇偶推出,必须走 placePages 真实配对。
  assert.equal(withoutToc[1]!.folio, 1);
  assert.equal(withoutToc[1]!.side, 'left');
  assert.equal(withToc[2]!.folio, 1);
  assert.equal(withToc[2]!.side, 'right', 'I1 的 side 应随 toc 插入而从 left 翻到 right');

  // 全量对照,顺带验证 mutation-sensitivity:插 toc 后的 5 项数组里,末位 ending
  // 下标是 4(偶)。若实现退化成"按数组下标奇偶判断 side"，会给出 'right'，
  // 与真实版面(ending 恒为 left,不受 toc 影响)矛盾,从而把这种退化实现暴露出来。
  assert.deepEqual(withoutToc.map((info) => info.side), ['right', 'left', 'right', 'left']);
  assert.deepEqual(withToc.map((info) => info.side), ['right', 'left', 'right', 'left', 'left']);
});
