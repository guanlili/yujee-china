import type { ComponentType } from 'react';
import type { TemplateRenderProps } from './templates/types';

// PDF templates only. Imported exclusively by lib/pdf/render.ts, which is itself
// dynamically imported at export time — so @react-pdf/renderer is confined to
// the lazy PDF chunk and never loaded on the editor's first paint.

import { PdfMag01 } from './templates/mag-01/pdf';
import { PdfMag02 } from './templates/mag-02/pdf';
import { PdfMag03 } from './templates/mag-03/pdf';
import { PdfMag04 } from './templates/mag-04/pdf';
import { PdfMag05 } from './templates/mag-05/pdf';
import { PdfMag06 } from './templates/mag-06/pdf';
import { PdfMag07 } from './templates/mag-07/pdf';
import { PdfMag08 } from './templates/mag-08/pdf';
import { PdfMag09 } from './templates/mag-09/pdf';
import { PdfMag10 } from './templates/mag-10/pdf';
import { PdfMag11 } from './templates/mag-11/pdf';
import { PdfMag12 } from './templates/mag-12/pdf';
import { PdfMag13 } from './templates/mag-13/pdf';
import { PdfMag14 } from './templates/mag-14/pdf';
import { PdfMag15 } from './templates/mag-15/pdf';
import { PdfMag16 } from './templates/mag-16/pdf';
import { PdfMag17 } from './templates/mag-17/pdf';
import { PdfMag18 } from './templates/mag-18/pdf';
import { PdfMag19 } from './templates/mag-19/pdf';
import { PdfMag20 } from './templates/mag-20/pdf';
import { PdfP01 } from './templates/p01/pdf';

export const PDF_TEMPLATE_REGISTRY: Record<string, ComponentType<TemplateRenderProps>> = {
  'mag-01': PdfMag01,
  'mag-02': PdfMag02,
  'mag-03': PdfMag03,
  'mag-04': PdfMag04,
  'mag-05': PdfMag05,
  'mag-06': PdfMag06,
  'mag-07': PdfMag07,
  'mag-08': PdfMag08,
  'mag-09': PdfMag09,
  'mag-10': PdfMag10,
  'mag-11': PdfMag11,
  'mag-12': PdfMag12,
  'mag-13': PdfMag13,
  'mag-14': PdfMag14,
  'mag-15': PdfMag15,
  'mag-16': PdfMag16,
  'mag-17': PdfMag17,
  'mag-18': PdfMag18,
  'mag-19': PdfMag19,
  'mag-20': PdfMag20,
  p01: PdfP01,
};

export function getPdfTemplate(id: string): ComponentType<TemplateRenderProps> | undefined {
  return PDF_TEMPLATE_REGISTRY[id];
}
