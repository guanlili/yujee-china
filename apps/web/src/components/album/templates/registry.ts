import { TEMPLATE_IDS } from '@yujee/contracts/templates';
import type { TemplateEntry } from './types';

import { WebMag01 } from './mag-01';
import { PdfMag01 } from './mag-01/pdf';
import { WebMag02 } from './mag-02';
import { PdfMag02 } from './mag-02/pdf';
import { WebMag03 } from './mag-03';
import { PdfMag03 } from './mag-03/pdf';
import { WebMag04 } from './mag-04';
import { PdfMag04 } from './mag-04/pdf';
import { WebMag05 } from './mag-05';
import { PdfMag05 } from './mag-05/pdf';
import { WebMag06 } from './mag-06';
import { PdfMag06 } from './mag-06/pdf';
import { WebMag07 } from './mag-07';
import { PdfMag07 } from './mag-07/pdf';
import { WebMag08 } from './mag-08';
import { PdfMag08 } from './mag-08/pdf';
import { WebMag09 } from './mag-09';
import { PdfMag09 } from './mag-09/pdf';
import { WebMag10 } from './mag-10';
import { PdfMag10 } from './mag-10/pdf';
import { WebMag11 } from './mag-11';
import { PdfMag11 } from './mag-11/pdf';
import { WebMag13 } from './mag-13';
import { PdfMag13 } from './mag-13/pdf';
import { WebMag15 } from './mag-15';
import { PdfMag15 } from './mag-15/pdf';
import { WebMag18 } from './mag-18';
import { PdfMag18 } from './mag-18/pdf';
import { WebMag19 } from './mag-19';
import { PdfMag19 } from './mag-19/pdf';
import { WebMag20 } from './mag-20';
import { PdfMag20 } from './mag-20/pdf';
import { WebP01 } from './p01';
import { PdfP01 } from './p01/pdf';

export const TEMPLATE_REGISTRY: Record<string, TemplateEntry> = {
  'mag-01': { id: 'mag-01', label: 'M-01 · VENUES', WebTemplate: WebMag01, PdfTemplate: PdfMag01 },
  'mag-02': { id: 'mag-02', label: 'M-02 · CONTENT', WebTemplate: WebMag02, PdfTemplate: PdfMag02 },
  'mag-03': { id: 'mag-03', label: 'M-03 · 满版照片', WebTemplate: WebMag03, PdfTemplate: PdfMag03 },
  'mag-04': { id: 'mag-04', label: 'M-04 · 一大两小', WebTemplate: WebMag04, PdfTemplate: PdfMag04 },
  'mag-05': { id: 'mag-05', label: 'M-05 · 大标题+横图', WebTemplate: WebMag05, PdfTemplate: PdfMag05 },
  'mag-06': { id: 'mag-06', label: 'M-06 · 满版风景', WebTemplate: WebMag06, PdfTemplate: PdfMag06 },
  'mag-07': { id: 'mag-07', label: 'M-07 · 多图+底标', WebTemplate: WebMag07, PdfTemplate: PdfMag07 },
  'mag-08': { id: 'mag-08', label: 'M-08 · 人物+双栏', WebTemplate: WebMag08, PdfTemplate: PdfMag08 },
  'mag-09': { id: 'mag-09', label: 'M-09 · 双图+引文', WebTemplate: WebMag09, PdfTemplate: PdfMag09 },
  'mag-10': { id: 'mag-10', label: 'M-10 · 四宫格', WebTemplate: WebMag10, PdfTemplate: PdfMag10 },
  'mag-11': { id: 'mag-11', label: 'M-11 · 照片+侧栏', WebTemplate: WebMag11, PdfTemplate: PdfMag11 },
  'mag-13': { id: 'mag-13', label: 'M-13 · 摄影师扉页', WebTemplate: WebMag13, PdfTemplate: PdfMag13 },
  'mag-15': { id: 'mag-15', label: 'M-15 · 双图错位', WebTemplate: WebMag15, PdfTemplate: PdfMag15 },
  'mag-18': { id: 'mag-18', label: 'M-18 · 并排双图', WebTemplate: WebMag18, PdfTemplate: PdfMag18 },
  'mag-19': { id: 'mag-19', label: 'M-19 · 居中大图', WebTemplate: WebMag19, PdfTemplate: PdfMag19 },
  'mag-20': { id: 'mag-20', label: 'M-20 · 单图记录', WebTemplate: WebMag20, PdfTemplate: PdfMag20 },
  p01: { id: 'p01', label: 'P01 · 暗色满版人像', WebTemplate: WebP01, PdfTemplate: PdfP01 },
};

// 一致性自检:registry 必须覆盖 contracts 里登记的所有 templateId
const missing = TEMPLATE_IDS.filter((id) => !(id in TEMPLATE_REGISTRY));
if (missing.length > 0) {
  throw new Error(`templates/registry: 缺少模板 ${missing.join(', ')}`);
}

export function getTemplateEntry(id: string): TemplateEntry | undefined {
  return TEMPLATE_REGISTRY[id];
}

export function listTemplates(): TemplateEntry[] {
  return TEMPLATE_IDS.map((id) => {
    const entry = TEMPLATE_REGISTRY[id];
    if (!entry) {
      throw new Error(`templates/registry: 缺失 ${id}`);
    }
    return entry;
  });
}
