// HTML 模板填充（收敛成单一渲染器的试点）。模板是一份 794×1123 的 HTML/CSS，
// 动态部分用 {{TYPE:slotId|default}} token 标注；本函数把当前页数据填进去，产出
// 可直接 innerHTML / html2canvas 的 HTML 字符串。同构（无 DOMParser，服务端/浏览器
// 都能跑），复用现有 adapt-layout（槽位适配）+ theme-carrier（主题色/字体）。
//
// token 语法：
//   {{TEXT:slotId}}            槽位文案（HTML 转义）
//   {{COLOR:slotId|#1c1b18}}   variableDecor 强调色，无则用默认
//   {{FONT:slotId|<stack>}}    variableDecor 艺术字体族，无则用默认
//   {{IMG_SRC:slotId}}         图槽解析后的 src
//   {{IMG_POS:slotId|50% 50%}} 图片 object-position
//   {{IMG_TF:slotId}}          图片缩放 transform（scale>1 时），否则空
import { adaptPageToTemplateData } from '../../adapt-layout';
import type { ResolveImage } from '../../adapt-layout';
import { resolveThemeCarrier } from '../theme-carrier';
import type { ImagePos, TemplateData } from '../types';
import { getHtmlTemplate } from './registry';

export interface FillablePage {
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
  imagePos?: Record<string, ImagePos> | null;
}

const TOKEN_RE = /\{\{(TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF):([^}|]+)(?:\|([^}]*))?\}\}/g;

export function fillTemplateHtml(templateHtml: string, page: FillablePage, resolveImage: ResolveImage): string {
  const data = adaptPageToTemplateData(
    { templateId: page.templateId, images: page.images, texts: page.texts },
    resolveImage,
  );
  const imagePos = page.imagePos ?? {};

  return templateHtml.replace(TOKEN_RE, (_full, type: string, slotRaw: string, def?: string) => {
    const slot = slotRaw.trim();
    const fallback = def ?? '';
    switch (type) {
      case 'TEXT': {
        const carrier = resolveThemeCarrier(data, slot);
        return escapeHtml(carrier.text ?? stringOf(data[slot]));
      }
      case 'COLOR': {
        const carrier = resolveThemeCarrier(data, slot);
        return escapeAttr(carrier.accentColor ?? fallback);
      }
      case 'FONT': {
        const carrier = resolveThemeCarrier(data, slot);
        return escapeAttr(carrier.webFontFamily ?? fallback);
      }
      case 'IMG_SRC':
        return escapeAttr(stringOf(data[slot]));
      case 'IMG_POS': {
        const pos = imagePos[slot];
        return escapeAttr(pos ? `${pos.x}% ${pos.y}%` : fallback || '50% 50%');
      }
      case 'IMG_TF': {
        const pos = imagePos[slot];
        return pos && pos.scale > 1
          ? `transform:scale(${pos.scale});transform-origin:${pos.x}% ${pos.y}%;`
          : '';
      }
      default:
        return '';
    }
  });
}

// 页面 → HTML 字符串：有 HTML 模板走填充，否则返回 undefined 让调用方回退 React 组件。
export function renderPageHtml(page: FillablePage, resolveImage: ResolveImage): string | undefined {
  const tpl = getHtmlTemplate(page.templateId);
  if (!tpl) return undefined;
  return fillTemplateHtml(tpl, page, resolveImage);
}

function stringOf(value: TemplateData[string]): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
