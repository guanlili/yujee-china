import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPageHtml } from '@yujee/contracts/render';
import { repairMag09Html } from './repair-mag09-html';

// 老书修复(2026-08-23)。mag-09 的 HTML 模板曾把 body/explain/explain2 三个绝对定位的
// <p> 套在另一个绝对定位的外层 div 里,而它们写的是整页坐标 —— 浏览器把两层叠加,
// body 落到 (1008,260)、explain 落到 (120,1240)、explain2 落到 (120,1284),在 794×1123
// 的页面上等于三段字消失。模板已修,但**存库的 html 是页面真相、烘过就不再重烘**
// (bake-html 对已有 html 的页直接跳过),所以老书里那些页永远坏着。
//
// 修复走外科式补丁而不是清空重烘:重烘会吃掉用户改的字/颜色/字体和 AI write_page_html
// 的手工版面。补丁只拆掉两层外壳 + 把 body2 从正常流改成显式坐标,其余一个字不动。
//
// 这里的黄金对照:**老模板烘出来的页,补丁后必须等价于新模板烘出来的同一页**。

const SAMPLE = {
  templateId: 'mag-09',
  images: { image1: 'p1', image2: 'p2' },
  texts: {
    body: '原来快乐可以这么简单',
    title: 'THE\nGATE',
    explain: '退潮后留下一片湿亮的沙',
    explain2: '孩子追着浪花跑来跑去',
    body2: '他比去年九月高了四厘米。',
  },
};

const resolve = (photoId: string) =>
  `{{IMG_SRC:${photoId === 'p1' ? 'image1' : 'image2'}}}`;

/** 老模板(2026-08-22 拍平之前)烘出来的存库 html —— 线上老书里就是这个形态。 */
const OLD_BAKED = `<div data-template="mag-09" style="position:relative;width:794px;height:1123px;background:#fff;color:#1c1b18;overflow:hidden;box-sizing:border-box;font-family:&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif">
  <div data-image-slot="image1" style="position:absolute;left:50px;top:90px;width:300px;height:300px;overflow:hidden">
    <img data-image-slot="image1" src="{{IMG_SRC:image1}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%;" />
  </div>
  <div style="position:absolute;top:130px;right:60px;width:230px">
    <p data-text-key="body" style="position:absolute;left:504px;top:130px;width:230px;height:31px;line-height:1.7;color:#5a574f;font-family:&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif;letter-spacing:0.02em;text-align:justify;font-size:18px;white-space:pre-wrap">原来快乐可以这么简单</p>
  </div>
  <h1 data-text-key="title" data-variable-decor style="position:absolute;top:415px;left:60px;width:280px;height:180px;margin:0;overflow:hidden;font-family:&quot;Playfair Display&quot;, &quot;Noto Serif SC&quot;, &quot;Songti SC&quot;, serif;font-weight:400;font-size:116px;letter-spacing:0.02em;line-height:1.1;color:#1c1b18;white-space:pre-line"><span style="white-space:pre-wrap">THE
GATE</span></h1>
  <div data-image-slot="image2" style="position:absolute;left:374px;top:400px;width:370px;height:600px;overflow:hidden">
    <img data-image-slot="image2" src="{{IMG_SRC:image2}}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%;" />
  </div>
  <div style="position:absolute;top:620px;left:60px;width:280px;line-height:1.75;color:currentColor;letter-spacing:0.02em;text-align:justify">
    <p data-text-key="explain" style="position:absolute;left:60px;top:620px;width:280px;height:32px;font-size:14px;color:#5a574f;font-family:&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif;white-space:pre-wrap;letter-spacing:0.02em;line-height:1.6">退潮后留下一片湿亮的沙</p>
    <p data-text-key="explain2" style="position:absolute;left:60px;top:664px;width:280px;height:32px;font-size:14px;color:#5a574f;font-family:&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif;white-space:pre-wrap;letter-spacing:0.02em;line-height:1.6">孩子追着浪花跑来跑去</p>
    <p data-text-key="body2" style="margin-top:12px;margin-bottom:0;font-size:18px;line-height:1.7;color:#5a574f;font-family:&quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, &quot;Heiti SC&quot;, sans-serif;white-space:pre-wrap;width:280px;height:200px;top:11px;letter-spacing:0.02em">他比去年九月高了四厘米。</p>
  </div>
</div>`;

// 只比「渲染上等价」,不比字节:style 声明按属性名排序、标签间的纯空白丢掉。
// 补丁是往已有 style 上 upsert,声明顺序必然与模板重写的顺序不同,但 CSS 语义一致
// (mag-09 没有同名声明相互覆盖的情况)。
function normalize(html: string): string {
  return html
    .replace(/>\s+</g, '><')
    .trim()
    .replace(/style="([^"]*)"/g, (_full, style: string) => {
      const SEMI = String.fromCharCode(0xe000);
      const guarded = style.replace(/&#?[a-z0-9]+;/gi, (e: string) => e.slice(0, -1) + SEMI);
      const decls = guarded
        .split(';')
        .map((p: string) => p.split(SEMI).join(';').trim())
        .filter(Boolean)
        .sort();
      return `style="${decls.join(';')}"`;
    });
}

test('老模板烘的页,补丁后与新模板烘的页等价', () => {
  const expected = renderPageHtml(SAMPLE, resolve);
  assert.ok(expected, '新模板必须能烘出 html');
  const repaired = repairMag09Html(OLD_BAKED);
  assert.ok(repaired, '老形态必须被识别并修复');
  assert.equal(normalize(repaired!), normalize(expected!));
});

test('已经是新形态的页不动它(幂等,可重复跑)', () => {
  const fresh = renderPageHtml(SAMPLE, resolve)!;
  assert.equal(repairMag09Html(fresh), null);
  // 补丁跑两遍与跑一遍结果相同
  const once = repairMag09Html(OLD_BAKED)!;
  assert.equal(repairMag09Html(once), null);
});

test('保留用户改过的文案与颜色(不是清空重烘)', () => {
  // 编辑器改颜色走 patchHtmlTextStyle,是 upsert 已有声明(不是往前面插一条),
  // 所以夹具也照那个形态改 body2 自己那条 color。
  const edited = OLD_BAKED.replace('原来快乐可以这么简单', '我自己改的一句话').replace(
    /(<p data-text-key="body2"[^>]*?)color:#5a574f/,
    '$1color:#b04a2f',
  );
  const repaired = repairMag09Html(edited);
  assert.ok(repaired);
  assert.match(repaired!, /我自己改的一句话/);
  assert.match(repaired!, /data-text-key="body2"[^>]*color:#b04a2f/);
  // 位置仍被修正
  assert.match(repaired!, /data-text-key="body2"[^>]*top:708px/);
  assert.match(repaired!, /data-text-key="body2"[^>]*position:absolute/);
  assert.doesNotMatch(repaired!, /margin-top:12px/);
});

test('认不出的页(AI 重写过版面)返回 null,不瞎改', () => {
  const rewritten =
    '<div data-template="mag-09" style="position:relative;width:794px;height:1123px">' +
    '<p data-text-key="body" style="position:absolute;left:40px;top:40px">AI 重排过</p></div>';
  assert.equal(repairMag09Html(rewritten), null);
});

test('别的模板一律不碰', () => {
  const other = renderPageHtml(
    { templateId: 'mag-07', images: { image1: 'p1', image2: 'p2' }, texts: { body: 'a', body2: 'b', title: 'c' } },
    resolve,
  )!;
  assert.equal(repairMag09Html(other), null);
});
