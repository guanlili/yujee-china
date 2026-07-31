'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';

import { fitTextBoxes } from './page-html-dom';

/**
 * 「注入了页面 HTML 的容器」→ 跑一遍文字槽的字号自适应。
 *
 * 模板的文字槽是**写死的固定高度**(见 render/html-templates/*:`height:300px` 之类),
 * 页根又是 overflow:hidden —— 装不下时不收字号,溢出的部分就直接被裁掉。所以每个
 * 渲染真实版面的表面都必须跑这一步:桌面在 EditorPort.paintEl、导出在 render-raster、
 * FlipBook/PagePreview 在 FittedPageHtml、移动端在 MobileEditor/EditView。
 *
 * **每次 commit 都跑,有意不绑依赖数组。** 页面 HTML 是 dangerouslySetInnerHTML 注进去的:
 * 任何一次重渲只要换掉那个字符串,节点就连同已经收好的字号一起被换回初始值。依赖数组必漏
 * —— 本地真机抓到的正是这个:effect 跑过、body 也确实收到了 16px,随后一次重渲把节点换掉,
 * 而依赖没变所以不再收,最终停在 18px、溢出 67px 被页根裁掉。桌面 paintEl 从来没这个问题,
 * 因为它是「innerHTML 注入完当场 fitTextBoxes」——这里保持同一条口径。
 * fitTextBoxes 幂等且带记忆化(见 page-html-dom),命中缓存时只是几次 map 查找加一次样式
 * 写入,不值得为它维护一张必漏的依赖表。
 *
 * 抽成 hook 而不是让各处各写一遍,还有个硬理由:移动端那棵树有架构守卫,不许出现
 * `document.`(节点归 React 所有,不许去别人的树上摸)。这条对 document.fonts 是误伤,
 * 但把这行收进共享 hook 之后,守卫与实现两边都不用让步。
 */
export function useFitTextBoxes(
  ref: RefObject<HTMLElement | null>,
  /** false = 整个 pass 跳过(缩略图那种几十 px 的表面,字号自适应看不见)。 */
  enabled = true,
): void {
  // 无依赖数组 = 每次 commit 之后都收一遍。理由见上,别加回来。
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    fitTextBoxes(ref.current);
  });

  // 字体是异步的(中文走 /api/v1/fonts/subset 按需子集,注册完才存在),拿回退字量出来的
  // 字号是错的。字体到货一般会让上游 useAlbumFonts 翻 ready → 触发 commit → 上面那条
  // 自然重收;这一条是给「没有 fontsReady 可依赖」的表面兜底。
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void document.fonts?.ready?.then(() => {
      if (!cancelled && ref.current) fitTextBoxes(ref.current);
    });
    return () => {
      cancelled = true;
    };
  }, [ref, enabled]);
}
