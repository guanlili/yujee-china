// HTML 模板注册表(页面真相 = HTML)。未注册的模板渲染端回退 React 组件,
// M2 全量后回退路径退役。
import { MAG_01_HTML } from './mag-01';
import { MAG_02_HTML } from './mag-02';
import { MAG_03_HTML } from './mag-03';
import { MAG_04_HTML } from './mag-04';
import { MAG_05_HTML } from './mag-05';
import { MAG_06_HTML } from './mag-06';
import { MAG_07_HTML } from './mag-07';
import { MAG_08_HTML } from './mag-08';
import { MAG_09_HTML } from './mag-09';

import { MAG_10_HTML } from './mag-10';
import { MAG_11_HTML } from './mag-11';
import { MAG_13_HTML } from './mag-13';
import { MAG_15_HTML } from './mag-15';
import { MAG_18_HTML } from './mag-18';
import { MAG_19_HTML } from './mag-19';
import { MAG_20_HTML } from './mag-20';
import { MAG_22_HTML } from './mag-22';
import { MAG_23_HTML } from './mag-23';
import { MAG_25_HTML } from './mag-25';

const HTML_TEMPLATE_REGISTRY: Record<string, string> = {
  'mag-01': MAG_01_HTML,
  'mag-02': MAG_02_HTML,
  'mag-03': MAG_03_HTML,
  'mag-04': MAG_04_HTML,
  'mag-05': MAG_05_HTML,
  'mag-06': MAG_06_HTML,
  'mag-07': MAG_07_HTML,
  'mag-08': MAG_08_HTML,
  'mag-09': MAG_09_HTML,
  'mag-10': MAG_10_HTML,
  'mag-11': MAG_11_HTML,
  'mag-13': MAG_13_HTML,
  'mag-15': MAG_15_HTML,
  'mag-18': MAG_18_HTML,
  'mag-19': MAG_19_HTML,
  'mag-20': MAG_20_HTML,
  'mag-22': MAG_22_HTML,
  'mag-23': MAG_23_HTML,
  'mag-25': MAG_25_HTML,
};

export function getHtmlTemplate(id: string): string | undefined {
  return HTML_TEMPLATE_REGISTRY[id];
}

export function hasHtmlTemplate(id: string): boolean {
  return id in HTML_TEMPLATE_REGISTRY;
}

export const HTML_TEMPLATE_IDS: string[] = Object.keys(HTML_TEMPLATE_REGISTRY);
