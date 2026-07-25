import { pageBox } from '@yujee/contracts/render/page-box';

// 跨页(#303)导出的「开盒尺寸」决策,抽成纯函数单独一个模块 —— render-raster.ts
// 拉着 react-dom/server + DOM 模块,没法在无 DOM 的 test runner 里 import。
// 这里是 PDF / 单页 JPG / 拼图 / Live 视频四条导出路径**唯一**的截图尺寸真相:
// 离屏 host 的 width/height 和 html2canvas 的 width/height 必须同源于 pageBox(),
// 否则双宽页只截到左半 794px(右半连同右下角页码一起被裁掉)。
export interface FaceCaptureSpec {
  /** 离屏 host 与 html2canvas 视口的宽(CSS px);双宽页 = 1588。 */
  width: number;
  /** 同上的高;所有模板都是 1123。 */
  height: number;
  /** 离屏 host 的 cssText(移出视口、定尺、裁溢出、白底)。 */
  cssText: string;
}

export function faceCaptureSpec(templateId: string): FaceCaptureSpec {
  const { width, height } = pageBox(templateId);
  return {
    width,
    height,
    cssText:
      `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;` +
      `overflow:hidden;background:#fff`,
  };
}
