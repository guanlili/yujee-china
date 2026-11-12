// EditorBook 巨型 effect 的阶段 1:先建上下文与纯函数的落点。
//
// 背景(#328 测绘结果):`EditorBook.tsx` 5,695 行,其中 272–5525 行是**一个**
// useEffect(依赖 []),里面 242 个闭包函数共享 root / i18n / spreads / pagesState。
// 按 JSX 切组件切不动,只能按 data-action 的域搬。
//
// 这一阶段只做两件事,都不改行为:
//   1. 定义 `EditorCanvasContext` —— 后续阶段搬出去的函数都从它取依赖
//   2. 把不依赖 DOM 的纯函数先搬出来(最小的一块,用来验证模式)
//
// 约定:
//   - 这里只放**能独立测试**的东西。任何需要 DOM 的留在 EditorBook,等后续阶段
//     把 ctx 传进来再搬。
//   - 不要在 effect 里改调用点形状:effect 侧保留一行同名包装,零行为变化优先。
import type { EditorPage } from '../types';
import type { Locale } from '@/lib/i18n/routing';

/** 巨型 effect 里被 242 个闭包共享的那组依赖。
 *
 *  目前只有 DOM 快捷方式与 i18n —— 它们是**只读**的,搬出去最安全。
 *  带可变状态(pagesState / spreads / exportGateLocked)的成员等后续阶段,
 *  因为搬它们要连带处理「谁负责写」,那是行为变更,不属于本阶段。 */
export type EditorCanvasContext = {
  /** 编辑器的共享外层根(由稳定 shell 创建,含顶栏与弹窗)。所有 DOM 查询都 scope 在它内。 */
  root: HTMLElement;
  locale: Locale;
  /** 当前是否 authoring 模式(草稿只读态)。 */
  isAuthoring: boolean;
  /** root.querySelector 的简写。 */
  $: (sel: string) => HTMLElement | null;
  /** root.querySelectorAll 的简写(原样返回 NodeList)。 */
  $$: (sel: string) => NodeListOf<Element>;
  /** 按 id 取(root 内),内部已做 CSS.escape。 */
  byId: (id: string) => HTMLElement | null;
  /** 扫 data-action 用:整棵 root,排除对话栏子树(.pane-chat-col 由 ChatPanel 自己绑)。 */
  $$scoped: (sel: string) => Element[];
  /** 原来被 toggled 的 body:scope 后就是 root 本身。 */
  bodyEl: HTMLElement;
  /** 按 key 取文案(zh 兜底 en 兜底 key)。 */
  t: (key: string) => string;
  /** 就地给中英两版(取当前 locale)。 */
  aT: (zh: string, en: string) => string;
};

/** 按「展示层页码」找页。纯函数,不碰 DOM、不碰可变状态。 */
export function findPageByIndex(pages: readonly EditorPage[], idx: number): EditorPage | undefined {
  return pages.find((p) => p.pageIndex === idx);
}

/** 跨页数至少 1(空书也要有一跨,画布不会退化成 0 页)。 */
export function countSpreads(spreads: { length: number }): number {
  return Math.max(1, spreads.length);
}
