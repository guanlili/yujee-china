/* dev 预览页(app/[locale]/dev/mobile)的样例书必须守住锚点契约。

   这页存在的理由就是「不接 DB/登录也能验收移动端编辑态」(见 55eece7a)。可它的 html 是
   手写的、不走模板渲染,曾经三个锚点全缺 —— 编辑态能进,但点文字命不中
   (EditView 靠 e.target.closest('[data-text-key]'))、底色也定位不到页根
   (readPageBg 靠 data-template),于是「颜色/字体/字号全都不可用」。真实相册没这问题
   (html 由 47 个模板渲染,锚点齐全),所以这条守卫只盯样例数据本身。

   上线前删 dev/mobile 目录时,这个文件一起删。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readPageBg } from './page-edit';
import { SAMPLE_PAGES } from '../../../../app/[locale]/dev/mobile/sample';

test('dev 样例书:每页 html 都带 data-template(否则底色 patch 定位不到页根)', () => {
  assert.ok(SAMPLE_PAGES.length > 0, '样例书不能是空的');
  for (const p of SAMPLE_PAGES) {
    const html = String(p.htmlJson);
    assert.match(
      html,
      new RegExp(`<[a-z0-9]+\\b[^>]*\\bdata-template="${p.templateId}"`, 'i'),
      `第 ${p.pageIndex} 页缺 data-template="${p.templateId}"`,
    );
    // patcher 真的能读到页根(与 applyPageBg 同一条正则口径)。
    assert.doesNotThrow(() => readPageBg(p));
  }
});

test('dev 样例书:每页至少一个 data-text-key 文字槽(否则点文字永远选不中)', () => {
  for (const p of SAMPLE_PAGES) {
    const keys = [...String(p.htmlJson).matchAll(/data-text-key="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(
      keys.length > 0,
      `第 ${p.pageIndex} 页没有任何 data-text-key —— 编辑态里点文字命不中,颜色/字体/字号全验收不了`,
    );
    assert.equal(new Set(keys).size, keys.length, `第 ${p.pageIndex} 页文字槽 key 重复: ${keys.join(',')}`);
  }
});

test('dev 样例书:文字槽 key 里必须有可点中的非空文案(空槽点不到)', () => {
  const clickable = SAMPLE_PAGES.filter((p) =>
    // 槽里有非空文本 = 真机上点得到
    /data-text-key="[^"]+"[^>]*>[^<\s]/.test(String(p.htmlJson)),
  );
  assert.ok(
    clickable.length >= SAMPLE_PAGES.length - 1,
    `只有 ${clickable.length}/${SAMPLE_PAGES.length} 页有可点中的文字槽`,
  );
});
