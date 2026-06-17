import type { ComponentType } from 'react';

export type TemplateDataValue = string | number | undefined | TemplateArrayItem[];
export type TemplateArrayItem = Record<string, string | undefined>;

export type TemplateData = Record<string, TemplateDataValue>;

// Per-image render override (#165). x,y are object-position percentages (0-100);
// scale >=1 zooms (applied in BOTH web and PDF render, see pdf-utils PdfImage).
export interface ImagePos {
  x: number;
  y: number;
  scale: number;
}

export interface TemplateRenderProps<D extends TemplateData = TemplateData> {
  data: D;
  totalPages?: number;
  // Optional per-slot position/scale overrides, keyed by the same slotId the
  // template's image slots use (e.g. `image`, `imageTop`, `cells[0].image`).
  // Absent slot => renderer falls back to 50/50/1 (pre-#165 behaviour).
  imagePos?: Record<string, ImagePos>;
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
