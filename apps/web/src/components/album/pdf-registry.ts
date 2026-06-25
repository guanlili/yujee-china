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
import { PdfMag13 } from './templates/mag-13/pdf';
import { PdfMag15 } from './templates/mag-15/pdf';
import { PdfMag18 } from './templates/mag-18/pdf';
import { PdfMag19 } from './templates/mag-19/pdf';
import { PdfMag20 } from './templates/mag-20/pdf';
import { PdfP01 } from './templates/p01/pdf';

import { PdfMag22 } from './templates/mag-22/pdf';
import { PdfMag23 } from './templates/mag-23/pdf';
import { PdfMag25 } from './templates/mag-25/pdf';
import { PdfMag26 } from './templates/mag-26/pdf';
import { PdfMag27 } from './templates/mag-27/pdf';
import { PdfMag28 } from './templates/mag-28/pdf';
import { PdfMag29 } from './templates/mag-29/pdf';
import { PdfMag30 } from './templates/mag-30/pdf';
import { PdfMag31 } from './templates/mag-31/pdf';
import { PdfMag32 } from './templates/mag-32/pdf';
import { PdfMag33 } from './templates/mag-33/pdf';
import { PdfMag34 } from './templates/mag-34/pdf';
import { PdfMag35 } from './templates/mag-35/pdf';
import { PdfMag36 } from './templates/mag-36/pdf';
import { PdfMag37 } from './templates/mag-37/pdf';
import { PdfMag38 } from './templates/mag-38/pdf';
import { PdfMag39 } from './templates/mag-39/pdf';
import { PdfMag40 } from './templates/mag-40/pdf';
import { PdfMag41 } from './templates/mag-41/pdf';
import { PdfMag42 } from './templates/mag-42/pdf';
import { PdfMag43 } from './templates/mag-43/pdf';
import { PdfMag44 } from './templates/mag-44/pdf';
import { PdfMag45 } from './templates/mag-45/pdf';
import { PdfMag46 } from './templates/mag-46/pdf';
import { PdfMag47 } from './templates/mag-47/pdf';
import { PdfMag48 } from './templates/mag-48/pdf';
import { PdfMag49 } from './templates/mag-49/pdf';
import { PdfMag50 } from './templates/mag-50/pdf';
import { PdfMag51 } from './templates/mag-51/pdf';
import { PdfMag52 } from './templates/mag-52/pdf';
import { PdfMag53 } from './templates/mag-53/pdf';
export const PDF_TEMPLATE_REGISTRY: Record<string, ComponentType<TemplateRenderProps>> = {
  'mag-53': PdfMag53,
  'mag-52': PdfMag52,
  'mag-51': PdfMag51,
  'mag-50': PdfMag50,
  'mag-49': PdfMag49,
  'mag-48': PdfMag48,
  'mag-47': PdfMag47,
  'mag-46': PdfMag46,
  'mag-45': PdfMag45,
  'mag-44': PdfMag44,
  'mag-43': PdfMag43,
  'mag-42': PdfMag42,
  'mag-41': PdfMag41,
  'mag-40': PdfMag40,
  'mag-39': PdfMag39,
  'mag-38': PdfMag38,
  'mag-37': PdfMag37,
  'mag-36': PdfMag36,
  'mag-35': PdfMag35,
  'mag-34': PdfMag34,
  'mag-33': PdfMag33,
  'mag-32': PdfMag32,
  'mag-31': PdfMag31,
  'mag-30': PdfMag30,
  'mag-29': PdfMag29,
  'mag-28': PdfMag28,
  'mag-27': PdfMag27,
  'mag-26': PdfMag26,
  'mag-25': PdfMag25,
  'mag-23': PdfMag23,
  'mag-22': PdfMag22,
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
  'mag-13': PdfMag13,
  'mag-15': PdfMag15,
  'mag-18': PdfMag18,
  'mag-19': PdfMag19,
  'mag-20': PdfMag20,
  p01: PdfP01,
};

export function getPdfTemplate(id: string): ComponentType<TemplateRenderProps> | undefined {
  return PDF_TEMPLATE_REGISTRY[id];
}
