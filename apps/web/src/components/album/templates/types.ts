import type { ComponentType } from 'react';

export type TemplateDataValue = string | number | undefined | TemplateArrayItem[];
export type TemplateArrayItem = Record<string, string | undefined>;

export type TemplateData = Record<string, TemplateDataValue>;

export interface TemplateRenderProps<D extends TemplateData = TemplateData> {
  data: D;
  totalPages?: number;
}

export interface TemplateEntry {
  id: string;
  label: string;
  WebTemplate: ComponentType<TemplateRenderProps>;
  PdfTemplate: ComponentType<TemplateRenderProps>;
}

export interface ToCItem {
  n?: string;
  title?: string;
  body?: string;
}

export interface GridCell {
  n?: string;
  image?: string;
  caption?: string;
}
