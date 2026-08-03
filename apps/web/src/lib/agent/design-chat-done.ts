/* design-chat 一轮结束(done 事件)的载荷收口。

   design-agent 的写工具(move_pages/delete_page)只动 pages 数组顺序、不改页对象的
   pageIndex 字段(album-move-pages-tool.test.ts 锁死逐字节不变)。Web 侧「数组下标 ==
   pageIndex 且连续」是行级世界的一致性不变式:落库(persistDesignChat)与回发浏览器
   (done 事件 → 桌面 replacePages / 移动 onPages)必须吃**同一份**按数组序重编号的
   pages —— 只重编号落库那份、把原始数组回给浏览器,编辑器一切按 pageIndex 寻址的
   操作(选中/改字/删页/下一轮 currentPageIndex)就会打错页,且越挪越乱。 */

export type DesignDoneResponse = {
  assistant?: { text?: unknown };
  committed?: unknown;
  book?: { pages?: unknown };
};

export type DesignDonePayload = {
  assistantReply: string;
  committed: boolean;
  /** 按数组序重编号 pageIndex(0..n-1)后的页数组。非对象条目原样透传,
   *  垃圾数据留给落库侧 Page.parse 拒绝,这里不吞不炸。 */
  pages: unknown[];
};

export function buildDesignDonePayload(response: DesignDoneResponse): DesignDonePayload {
  const rawPages = Array.isArray(response.book?.pages) ? response.book.pages : [];
  return {
    assistantReply: typeof response.assistant?.text === 'string' ? response.assistant.text : '',
    committed: response.committed === true,
    pages: rawPages.map((page, i) =>
      page && typeof page === 'object' ? { ...page, pageIndex: i } : page,
    ),
  };
}
