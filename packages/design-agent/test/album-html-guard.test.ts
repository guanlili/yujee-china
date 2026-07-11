import assert from "node:assert/strict";
import test from "node:test";
import { derivePageTexts, validatePageHtml } from "../src/core/album/html-guard.ts";

// write_page_html 的守门:AI 可以自由改版面(挪/改样式/加装饰),但
// ① 锚点(data-text-key / data-image-slot)一个不能丢 ② 图片 src 必须仍是
// {{IMG_SRC:*}} token ③ 禁脚本/事件/外链 ④ 根节点 data-template 不变 ⑤ ≤64KB。

const PREV = `<div data-template="mag-01" style="position:relative;width:794px;height:1123px">
  <div data-text-key="title" data-variable-decor style="font-size:72px;color:#1c1b18">夏日海岸</div>
  <div data-text-key="explain1" style="font-size:18px">一段说明</div>
  <div data-image-slot="image" style="position:absolute;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="object-fit:cover" />
  </div>
</div>`;

test("合法编辑通过:挪位置、改样式、加装饰、改文字", () => {
  const next = `<div data-template="mag-01" style="position:relative;width:794px;height:1123px;background:#faf8f4">
  <div class="deco" style="position:absolute;top:0;left:0;width:794px;height:8px;background:#2b4a6f"></div>
  <div data-text-key="title" data-variable-decor style="font-size:96px;color:#2b4a6f;transform:rotate(-2deg)">海风与盐</div>
  <div data-image-slot="image" style="position:absolute;top:300px;overflow:hidden">
    <img data-image-slot="image" src="{{IMG_SRC:image}}" alt="" style="object-fit:cover" />
  </div>
  <div data-text-key="explain1" style="font-size:16px;letter-spacing:0.1em">改写后的说明文字。</div>
</div>`;
  assert.deepEqual(validatePageHtml(PREV, next, "mag-01"), []);
});

test("丢锚点被拒:删掉 explain1", () => {
  const next = PREV.replace(/<div data-text-key="explain1"[^>]*>[^<]*<\/div>/, "");
  const errors = validatePageHtml(PREV, next, "mag-01");
  assert.equal(errors.length > 0, true);
  assert.match(errors.join("\n"), /explain1/);
});

test("图片 src 不再是 token 被拒", () => {
  const next = PREV.replace("{{IMG_SRC:image}}", "https://evil.example/x.jpg");
  const errors = validatePageHtml(PREV, next, "mag-01");
  assert.match(errors.join("\n"), /IMG_SRC|src/);
});

test("script / 事件属性 / javascript: 被拒", () => {
  for (const inject of [
    `<script>alert(1)</script>`,
    `<img data-image-slot="x" src="{{IMG_SRC:x}}" onerror="alert(1)" />`,
    `<a href="javascript:alert(1)">x</a>`,
    `<iframe src="{{IMG_SRC:x}}"></iframe>`,
  ]) {
    const next = PREV.replace("</div>\n</div>", `</div>${inject}\n</div>`);
    assert.equal(validatePageHtml(PREV, next, "mag-01").length > 0, true, `未拦截:${inject}`);
  }
});

test("根 data-template 被改 / 超 64KB 被拒", () => {
  assert.equal(validatePageHtml(PREV, PREV.replace('data-template="mag-01"', 'data-template="mag-02"'), "mag-01").length > 0, true);
  const huge = PREV.replace("夏日海岸", "长".repeat(66000));
  assert.equal(validatePageHtml(PREV, huge, "mag-01").length > 0, true);
});

test("derivePageTexts:从 data-text-key 提取文字(去内嵌标签、反转义)", () => {
  const html = `<div data-template="mag-01">
  <h1 data-text-key="title">A &amp; B<br/>C</h1>
  <p data-text-key="explain1">说明<span style="color:#999">/</span>文字</p>
  <div data-image-slot="image"><img data-image-slot="image" src="{{IMG_SRC:image}}"/></div>
</div>`;
  assert.deepEqual(derivePageTexts(html), { title: "A & B\nC", explain1: "说明/文字" });
});

test("patchHtmlText:原位替换槽位文字,保留元素与其余版面", async () => {
	const { patchHtmlText } = await import("../src/core/album/html-guard.ts");
	const html = `<div data-template="mag-01"><h1 data-text-key="title" style="color:#2b4a6f">旧标题</h1><p data-text-key="explain1">说明</p></div>`;
	const next = patchHtmlText(html, "title", "新 <标题> & 换行");
	assert.ok(next);
	assert.ok(next!.includes(`<h1 data-text-key="title" style="color:#2b4a6f">新 &lt;标题&gt; &amp; 换行</h1>`));
	assert.ok(next!.includes("说明"));
	assert.equal(patchHtmlText(html, "missing", "x"), null);
});
