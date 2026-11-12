// 编辑器画布的上下文骨架(2026-11-11,拆 EditorBook 的阶段 1)。
//
// 背景:EditorBook 里 272–5525 行是**一个** useEffect,里面 242 个闭包函数共享
// root / i18n / locale / spreads。要按域把它们搬出去,必须先有一个明确的上下文
// 对象可注入,否则每个函数都得拖一串参数。
//
// 本阶段**零行为变化**:EditorBook 里只是把 `$` / `$$` / `byId` / `$$scoped`
// 换成 ctx.q 提供的同名实现,全部调用点一行未动。
//
// 注意别误读:ctx 里的 i18n / albumId / isAuthoring 目前**只是骨架**,EditorBook
// 仍在用自己那份局部变量,阶段 2 搬导出域时才会真正消费。骨架先立,是为了让
// 阶段 2 的 diff 只有「搬函数 + 改上下文引用」,不夹带建接口。

export type CanvasQuery = {
  $(sel: string): HTMLElement | null;
  $$(sel: string): NodeListOf<Element>;
  byId(id: string): HTMLElement | null;
  /** 扫 data-action 时排除对话栏子树:那棵子树由 ChatPanel 自己绑,两边零重叠。 */
  $$scoped(sel: string): Element[];
};

export type CanvasCtx = {
  root: HTMLElement;
  /** 原脚本里 document.body 的角色(overview-on / chat-collapsed 等类名),这里锁在 root 上。 */
  bodyEl: HTMLElement;
  q: CanvasQuery;
  i18n: Record<string, Record<string, string>>;
  albumId: string;
  isAuthoring: boolean;
};

/** 把一棵挂载根包装成查询器。抽出来的价值:它能被单测覆盖,不必为了测四个
 *  查询函数去挂载整个 5,700 行的编辑器。 */
export function createCanvasQuery(root: HTMLElement): CanvasQuery {
  return {
    $: (sel: string) => root.querySelector(sel) as HTMLElement | null,
    $$: (sel: string) => root.querySelectorAll(sel),
    // CSS.escape 必须有:id 里带冒号/点(模板 id 里就有)时不转义会抛
    // SyntaxError,而那个错误会被外层 try 吞掉、表现为「按钮点了没反应」。
    byId: (id: string) => root.querySelector('#' + CSS.escape(id)) as HTMLElement | null,
    $$scoped: (sel: string) => [...root.querySelectorAll(sel)].filter((el) => !el.closest('.pane-chat-col')),
  };
}
