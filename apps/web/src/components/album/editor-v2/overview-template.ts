/**
 * 总览网格(画板)的 HTML 模板 —— 纯函数,不碰 DOM、不读闭包。
 *
 * 抽出来的理由不是「减行数」,而是这串模板里烘着**三个隐式契约**:
 *   - `data-ovidx`      → IntersectionObserver 懒绘制靠它回查跨页号
 *   - `data-oface`      → paintOvSpread 靠 `i-l` / `i-r` 定位左右 cell
 *   - `data-page-index` → 画布点选靠它把页号映射回 pagesState
 *
 * 这三个属性名写错一个,表现是「进入画板后整屏空白」或「点页没反应」,
 * 而它们此前只是模板字符串里的字面量,没有任何类型检查。抽成纯函数后可以单测锁死。
 */

export const OV_ATTR = {
  index: 'data-ovidx',
  face: 'data-oface',
  pageIndex: 'data-page-index',
} as const;

export interface OvSpreadSpec {
  /** 角标文案(spreadLabel 的结果),原样插入 */
  label: string;
  /** 双宽(#303)页:整张画进左 cell,右 cell 退场 */
  full: boolean;
  /** 左 cell 的页号;空 cell 为 null */
  leftIndex: number | null;
  /** 右 cell 的页号;空 cell 为 null */
  rightIndex: number | null;
}

export interface OvRenderOpts {
  /** 当前章节跨页号,用于 ov-current 高亮 */
  currentIndex: number;
  /** 画布选中的页号,用于 ov-page-selected */
  selectedPageIndex: number | null;
}

export function buildOverviewHtml(spreads: OvSpreadSpec[], opts: OvRenderOpts): string {
  return spreads
    .map((s, i) => {
      // #158 follow-up: solo spread 去掉 ov-book 底色与中缝,让空的一半读成空白而不是白页。
      const solo = !s.full && (s.leftIndex === null || s.rightIndex === null);
      const lSel = s.leftIndex !== null && s.leftIndex === opts.selectedPageIndex ? ' ov-page-selected' : '';
      const rSel = s.rightIndex !== null && s.rightIndex === opts.selectedPageIndex ? ' ov-page-selected' : '';
      const lpi = s.leftIndex === null ? '' : String(s.leftIndex);
      const rpi = s.rightIndex === null ? '' : String(s.rightIndex);
      return `<div class="ov-spread${i === opts.currentIndex ? ' ov-current' : ''}" ${OV_ATTR.index}="${i}">
          <div class="ov-book${solo ? ' ov-solo' : ''}${s.full ? ' ov-full' : ''}"><div class="ov-page ov-left${s.leftIndex === null ? ' ov-empty' : ''}${lSel}" ${OV_ATTR.face}="${i}-l" ${OV_ATTR.pageIndex}="${lpi}"></div><div class="ov-page ov-right${s.rightIndex === null ? ' ov-empty' : ''}${rSel}" ${OV_ATTR.face}="${i}-r" ${OV_ATTR.pageIndex}="${rpi}"></div></div>
          <div class="ov-cap">${s.label}</div>
        </div>`;
    })
    .join('');
}
