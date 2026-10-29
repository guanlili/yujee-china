import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdownSafe, ensureMarkdownLoaded } from './render';

await ensureMarkdownLoaded();
test('renders bold / list / heading', () => {
  const html = renderMarkdownSafe('## 标题\n\n**加粗** 内容\n\n- 甲\n- 乙');
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<li>甲<\/li>/);
});

test('breaks: single newline becomes <br>', () => {
  assert.match(renderMarkdownSafe('第一行\n第二行'), /<br\s*\/?>/);
});

test('escapes raw HTML from the source text', () => {
  const html = renderMarkdownSafe('<img src=x onerror=alert(1)> 正文');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('escapes raw HTML inside inline code and paragraphs', () => {
  const html = renderMarkdownSafe('`<script>` 与 <script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
});

test('neutralizes javascript: links', () => {
  const html = renderMarkdownSafe('[点我](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/);
});

test('keeps https links, adds target+rel', () => {
  const html = renderMarkdownSafe('[官网](https://example.com)');
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('plain text passes through as a paragraph', () => {
  const html = renderMarkdownSafe('平平无奇的一句话');
  assert.match(html, /<p>平平无奇的一句话<\/p>/);
});
