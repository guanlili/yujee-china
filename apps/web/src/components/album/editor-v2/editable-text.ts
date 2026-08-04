/* contentEditable 的换行安全取文。
 *
 * 桌面「双击改字」是 contentEditable:按 Enter 时浏览器插入的是节点
 * (Chrome 把第二行起包成 <div>、也可能是 <br>;白空格保留态下才是字面 \n)——
 * textContent 会把这些节点拼成一行,用户打的换行无声丢失。这里手工展开成 \n,
 * 与 textsJson / patchHtmlText 的「字面 \n + white-space:pre-wrap」约定对齐。
 *
 * 纯结构类型,零 DOM 依赖:真实 HTMLElement 结构兼容,node 直接可测(仓里没有 jsdom)。
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export interface EditableNodeLike {
  nodeType: number;
  nodeValue: string | null;
  tagName?: string;
  childNodes: ArrayLike<EditableNodeLike>;
}

/** contentEditable 元素取文:BR → \n;块级子节点(DIV/P)边界 → \n;其余展开递归。
 *  末尾多出的一个 \n 剥掉 —— contentEditable 常在结尾留一个占位 <br>(Firefox 恒有,
 *  Chrome 视情况),它是光标占位不是用户打的换行。 */
export function editableTextOf(el: EditableNodeLike): string {
  let out = '';
  const walk = (node: EditableNodeLike): void => {
    if (node.nodeType === TEXT_NODE) {
      out += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const tag = node.tagName ?? '';
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    // 空行是 <div><br></div>:边界一个 \n + 占位 BR 一个 \n,正好空出一行。
    if ((tag === 'DIV' || tag === 'P') && out !== '' && !out.endsWith('\n')) out += '\n';
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]!);
  };
  for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i]!);
  return out.endsWith('\n') ? out.slice(0, -1) : out;
}
