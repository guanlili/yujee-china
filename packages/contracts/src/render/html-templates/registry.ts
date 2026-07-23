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

import { MAG_26_HTML } from './mag-26';
import { MAG_27_HTML } from './mag-27';
import { MAG_28_HTML } from './mag-28';
import { MAG_29_HTML } from './mag-29';
import { MAG_30_HTML } from './mag-30';
import { MAG_31_HTML } from './mag-31';
import { MAG_32_HTML } from './mag-32';
import { MAG_33_HTML } from './mag-33';
import { MAG_34_HTML } from './mag-34';
import { MAG_36_HTML } from './mag-36';

import { MAG_39_HTML } from './mag-39';
import { MAG_40_HTML } from './mag-40';
import { MAG_41_HTML } from './mag-41';
import { MAG_42_HTML } from './mag-42';
import { MAG_43_HTML } from './mag-43';
import { MAG_44_HTML } from './mag-44';
import { MAG_45_HTML } from './mag-45';
import { MAG_46_HTML } from './mag-46';
import { MAG_47_HTML } from './mag-47';
import { MAG_48_HTML } from './mag-48';
import { MAG_49_HTML } from './mag-49';
import { MAG_51_HTML } from './mag-51';
import { MAG_54_HTML } from './mag-54';
import { MAG_55_HTML } from './mag-55';
import { MAG_56_HTML } from './mag-56';
import { P01_HTML } from './p01';

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
  'mag-26': MAG_26_HTML,
  'mag-27': MAG_27_HTML,
  'mag-28': MAG_28_HTML,
  'mag-29': MAG_29_HTML,
  'mag-30': MAG_30_HTML,
  'mag-31': MAG_31_HTML,
  'mag-32': MAG_32_HTML,
  'mag-33': MAG_33_HTML,
  'mag-34': MAG_34_HTML,
  'mag-36': MAG_36_HTML,
  'mag-39': MAG_39_HTML,
  'mag-40': MAG_40_HTML,
  'mag-41': MAG_41_HTML,
  'mag-42': MAG_42_HTML,
  'mag-43': MAG_43_HTML,
  'mag-44': MAG_44_HTML,
  'mag-45': MAG_45_HTML,
  'mag-46': MAG_46_HTML,
  'mag-47': MAG_47_HTML,
  'mag-48': MAG_48_HTML,
  'mag-49': MAG_49_HTML,
  'mag-51': MAG_51_HTML,
  'mag-54': MAG_54_HTML,
  'mag-55': MAG_55_HTML,
  'mag-56': MAG_56_HTML,
  'p01': P01_HTML,
};

export function getHtmlTemplate(id: string): string | undefined {
  return HTML_TEMPLATE_REGISTRY[id];
}

export function hasHtmlTemplate(id: string): boolean {
  return id in HTML_TEMPLATE_REGISTRY;
}

export const HTML_TEMPLATE_IDS: string[] = Object.keys(HTML_TEMPLATE_REGISTRY);
