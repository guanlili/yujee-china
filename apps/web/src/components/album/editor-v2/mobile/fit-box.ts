/* 一屏的几何:把开页等比塞进可视区。纯函数,便于单测与复用(编辑态满屏也用它)。 */

import { PAGE } from '../../templates/constants';

export type Box = { w: number; h: number };

/** 目标宽高比(w/h):一屏并排 halves 页。 */
export function spreadAspect(halves: number): number {
  return (PAGE.width * halves) / PAGE.height;
}

/** 等比贴合:结果既不超宽也不超高,比例严格保持(页面是照片版面,拉伸即事故)。 */
export function fitBox(areaW: number, areaH: number, aspect: number): Box {
  if (!(areaW > 0) || !(areaH > 0) || !(aspect > 0)) return { w: 0, h: 0 };
  const w = Math.min(areaW, areaH * aspect);
  return { w, h: w / aspect };
}
