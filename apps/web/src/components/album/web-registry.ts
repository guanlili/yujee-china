import type { ComponentType } from 'react';
import type { TemplateRenderProps } from './templates/types';

// Web templates only — none of these import @react-pdf/renderer. The editor
// imports this (not templates/registry.ts, which pulls in every pdf.tsx) so
// the editor's first-load JS stays free of the PDF runtime (B8 review item 2).

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

export const WEB_TEMPLATE_REGISTRY: Record<string, ComponentType<TemplateRenderProps>> = {
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
