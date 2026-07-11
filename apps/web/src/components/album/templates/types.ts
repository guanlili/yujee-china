// 纯类型迁至 @yujee/contracts/render;React 组件类型留在 web。
import type { ComponentType } from 'react';
import type { TemplateRenderProps } from '@yujee/contracts/render';

export type {
  TemplateDataValue,
  TemplateArrayItem,
  TemplateData,
  ImagePos,
  TemplateRenderProps,
  ToCItem,
  GridCell,
} from '@yujee/contracts/render';

// 矢量 PDF 渲染器已退役(C 方案:页面真相 = HTML,导出走栅格截屏),条目只剩 web 组件。
export interface TemplateEntry {
  id: string;
  label: string;
  WebTemplate: ComponentType<TemplateRenderProps>;
}
