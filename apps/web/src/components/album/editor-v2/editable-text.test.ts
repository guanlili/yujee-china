import assert from 'node:assert/strict';
import test from 'node:test';
import { editableTextOf, type EditableNodeLike } from './editable-text';

// contentEditable 取文:textContent 会把 <br>/<div> 换行节点拼成一行,
// 这里钉死 editableTextOf 的展开行为(与 textsJson 的字面 \n 约定对齐)。

function text(value: string): EditableNodeLike {
  return { nodeType: 3, nodeValue: value, childNodes: [] };
}
function el(tagName: string, ...childNodes: EditableNodeLike[]): EditableNodeLike {
  return { nodeType: 1, nodeValue: null, tagName, childNodes };
}

test('editableTextOf:纯文本节点(字面 \\n 原样保留)', () => {
  assert.equal(editableTextOf(el('DIV', text('第一行\n第二行'))), '第一行\n第二行');
});

test('editableTextOf:<br> 展开成 \\n', () => {
  assert.equal(editableTextOf(el('DIV', text('a'), el('BR'), text('b'))), 'a\nb');
});

test('editableTextOf:Chrome 的 div 包行展开成 \\n', () => {
  // <div>a</div><div>b</div> —— Enter 后第二行被包进 div
  assert.equal(editableTextOf(el('DIV', el('DIV', text('a')), el('DIV', text('b')))), 'a\nb');
});

test('editableTextOf:空行(<div><br></div>)空出一行', () => {
  const root = el('DIV', el('DIV', text('a')), el('DIV', el('BR')), el('DIV', text('b')));
  assert.equal(editableTextOf(root), 'a\n\nb');
});

test('editableTextOf:结尾占位 <br> 不算换行', () => {
  assert.equal(editableTextOf(el('DIV', text('a'), el('BR'))), 'a');
});

test('editableTextOf:span 等行内装饰只递归不加换行', () => {
  const root = el('DIV', el('SPAN', text('甲\n乙')));
  assert.equal(editableTextOf(root), '甲\n乙');
});
