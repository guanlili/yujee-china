// HTML 模板注册表（收敛单渲染器试点）。目前只 mag-01；未迁移的模板不在表里，
// 调用方（faceInner / FlipBook / PagePreview）查不到就回退现有 React 组件，两种并存。
import { MAG_01_HTML } from './mag-01';

const HTML_TEMPLATE_REGISTRY: Record<string, string> = {
  'mag-01': MAG_01_HTML,
};

export function getHtmlTemplate(id: string): string | undefined {
  return HTML_TEMPLATE_REGISTRY[id];
}

export function hasHtmlTemplate(id: string): boolean {
  return id in HTML_TEMPLATE_REGISTRY;
}
