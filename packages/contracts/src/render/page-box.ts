import { getTemplate } from '../templates';
import { PAGE } from './constants';

// 跨页(#303):一个 spread 模板 = 一张双宽画布(1588×1123),独占一整个物理跨页。
// 所有渲染面(画板/翻书/预览/PDF/拼图/候选缩略图)都必须按这里给的尺寸开盒,
// 而不是直接读 PAGE —— 单页模板的返回值与 PAGE 完全相同,故老模板逐像素不变。
export interface PageBox {
  width: number;
  height: number;
}

export function isSpreadTemplate(templateId: string): boolean {
  return getTemplate(templateId)?.spread === true;
}

export function pageBox(templateId: string): PageBox {
  return isSpreadTemplate(templateId)
    ? { width: PAGE.width * 2, height: PAGE.height }
    : { width: PAGE.width, height: PAGE.height };
}
