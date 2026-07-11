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

export interface TemplateEntry {
  id: string;
  label: string;
  WebTemplate: ComponentType<TemplateRenderProps>;
  PdfTemplate: ComponentType<TemplateRenderProps>;
}
