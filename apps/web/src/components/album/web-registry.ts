import type { ComponentType } from 'react';
import type { TemplateRenderProps } from './templates/types';

// Web templates only。矢量 PDF 渲染已退役(C 方案:页面真相 = HTML,导出走栅格
// 截屏),这里是唯一的渲染真相注册表:编辑器画板和导出截屏渲染的都是它。

import { WebMag01 } from './templates/mag-01';
import { WebMag02 } from './templates/mag-02';
import { WebMag03 } from './templates/mag-03';
import { WebMag04 } from './templates/mag-04';
import { WebMag05 } from './templates/mag-05';
import { WebMag06 } from './templates/mag-06';
import { WebMag07 } from './templates/mag-07';
import { WebMag08 } from './templates/mag-08';
import { WebMag09 } from './templates/mag-09';
import { WebMag10 } from './templates/mag-10';
import { WebMag11 } from './templates/mag-11';
import { WebMag13 } from './templates/mag-13';
import { WebMag15 } from './templates/mag-15';
import { WebMag18 } from './templates/mag-18';
import { WebMag19 } from './templates/mag-19';
import { WebMag20 } from './templates/mag-20';
import { WebP01 } from './templates/p01';

import { WebMag22 } from './templates/mag-22';
import { WebMag23 } from './templates/mag-23';
import { WebMag26 } from './templates/mag-26';
import { WebMag27 } from './templates/mag-27';
import { WebMag28 } from './templates/mag-28';
import { WebMag29 } from './templates/mag-29';
import { WebMag30 } from './templates/mag-30';
import { WebMag31 } from './templates/mag-31';
import { WebMag32 } from './templates/mag-32';
import { WebMag33 } from './templates/mag-33';
import { WebMag34 } from './templates/mag-34';
import { WebMag36 } from './templates/mag-36';
import { WebMag39 } from './templates/mag-39';
import { WebMag40 } from './templates/mag-40';
import { WebMag41 } from './templates/mag-41';
import { WebMag42 } from './templates/mag-42';
import { WebMag43 } from './templates/mag-43';
import { WebMag44 } from './templates/mag-44';
import { WebMag45 } from './templates/mag-45';
import { WebMag46 } from './templates/mag-46';
import { WebMag47 } from './templates/mag-47';
import { WebMag48 } from './templates/mag-48';
import { WebMag49 } from './templates/mag-49';
import { WebMag51 } from './templates/mag-51';
import { WebMag54 } from './templates/mag-54';
import { WebMag55 } from './templates/mag-55';
import { WebMag56 } from './templates/mag-56';
export const WEB_TEMPLATE_REGISTRY: Record<string, ComponentType<TemplateRenderProps>> = {
  'mag-56': WebMag56,
  'mag-55': WebMag55,
  'mag-54': WebMag54,
  'mag-51': WebMag51,
  'mag-49': WebMag49,
  'mag-48': WebMag48,
  'mag-47': WebMag47,
  'mag-46': WebMag46,
  'mag-45': WebMag45,
  'mag-44': WebMag44,
  'mag-43': WebMag43,
  'mag-42': WebMag42,
  'mag-41': WebMag41,
  'mag-40': WebMag40,
  'mag-39': WebMag39,
  'mag-36': WebMag36,
  'mag-34': WebMag34,
  'mag-33': WebMag33,
  'mag-32': WebMag32,
  'mag-31': WebMag31,
  'mag-30': WebMag30,
  'mag-29': WebMag29,
  'mag-28': WebMag28,
  'mag-27': WebMag27,
  'mag-26': WebMag26,
  'mag-23': WebMag23,
  'mag-22': WebMag22,
  'mag-01': WebMag01,
  'mag-02': WebMag02,
  'mag-03': WebMag03,
  'mag-04': WebMag04,
  'mag-05': WebMag05,
  'mag-06': WebMag06,
  'mag-07': WebMag07,
  'mag-08': WebMag08,
  'mag-09': WebMag09,
  'mag-10': WebMag10,
  'mag-11': WebMag11,
  'mag-13': WebMag13,
  'mag-15': WebMag15,
  'mag-18': WebMag18,
  'mag-19': WebMag19,
  'mag-20': WebMag20,
  p01: WebP01,
};

export function getWebTemplate(id: string): ComponentType<TemplateRenderProps> | undefined {
  return WEB_TEMPLATE_REGISTRY[id];
}
