import { TEMPLATE_IDS } from '@yujee/contracts/templates';
import type { TemplateEntry } from './types';

import { WebMag01 } from './mag-01';
import { WebMag02 } from './mag-02';
import { WebMag03 } from './mag-03';
import { WebMag04 } from './mag-04';
import { WebMag05 } from './mag-05';
import { WebMag06 } from './mag-06';
import { WebMag07 } from './mag-07';
import { WebMag08 } from './mag-08';
import { WebMag09 } from './mag-09';
import { WebMag10 } from './mag-10';
import { WebMag11 } from './mag-11';
import { WebMag13 } from './mag-13';
import { WebMag15 } from './mag-15';
import { WebMag18 } from './mag-18';
import { WebMag19 } from './mag-19';
import { WebMag20 } from './mag-20';
import { WebP01 } from './p01';

// 矢量 PDF 渲染器已退役(C 方案:页面真相 = HTML,导出走栅格截屏),条目只登记 web 组件。
export const TEMPLATE_REGISTRY: Record<string, TemplateEntry> = {
  'mag-01': { id: 'mag-01', label: 'M-01 · VENUES', WebTemplate: WebMag01 },
  'mag-02': { id: 'mag-02', label: 'M-02 · CONTENT', WebTemplate: WebMag02 },
  'mag-03': { id: 'mag-03', label: 'M-03 · 满版照片', WebTemplate: WebMag03 },
  'mag-04': { id: 'mag-04', label: 'M-04 · 一大两小', WebTemplate: WebMag04 },
  'mag-05': { id: 'mag-05', label: 'M-05 · 大标题+横图', WebTemplate: WebMag05 },
  'mag-06': { id: 'mag-06', label: 'M-06 · 满版风景', WebTemplate: WebMag06 },
  'mag-07': { id: 'mag-07', label: 'M-07 · 多图+底标', WebTemplate: WebMag07 },
  'mag-08': { id: 'mag-08', label: 'M-08 · 人物+双栏', WebTemplate: WebMag08 },
  'mag-09': { id: 'mag-09', label: 'M-09 · 双图+引文', WebTemplate: WebMag09 },
  'mag-10': { id: 'mag-10', label: 'M-10 · 四宫格', WebTemplate: WebMag10 },
  'mag-11': { id: 'mag-11', label: 'M-11 · 照片+侧栏', WebTemplate: WebMag11 },
  'mag-13': { id: 'mag-13', label: 'M-13 · 摄影师扉页', WebTemplate: WebMag13 },
  'mag-15': { id: 'mag-15', label: 'M-15 · 双图错位', WebTemplate: WebMag15 },
  'mag-18': { id: 'mag-18', label: 'M-18 · 并排双图', WebTemplate: WebMag18 },
  'mag-19': { id: 'mag-19', label: 'M-19 · 居中大图', WebTemplate: WebMag19 },
  'mag-20': { id: 'mag-20', label: 'M-20 · 单图记录', WebTemplate: WebMag20 },
  p01: { id: 'p01', label: 'P01 · 暗色满版人像', WebTemplate: WebP01 },
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
