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
import { adaptPageToTemplateData } from './adapt-layout';
import { getTemplate } from '../templates';
import type { ResolveImage } from './adapt-layout';
import { fitDisplayFontSize } from './constants';
import { resolveThemeCarrier, type AlbumTextRole } from './theme-carrier';
import { PAGE_BACKGROUND_CARRIER_KEY } from '../theme-carrier';
import type { ImagePos, TemplateData } from './types';
import { getHtmlTemplate } from './html-templates/registry';
import { applyPageBackground } from './page-background';

export interface FillablePage {
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
  imagePos?: Record<string, ImagePos> | null;
}

const TOKEN_RE = /\{\{(TEXT|COLOR|FONT|IMG_SRC|IMG_POS|IMG_TF|FIT_SIZE):([^}|]+)(?:\|([^}]*))?\}\}/g;

export function fillTemplateHtml(templateHtml: string, page: FillablePage, resolveImage: ResolveImage): string {
  const data = adaptPageToTemplateData(
    { templateId: page.templateId, images: page.images, texts: page.texts },
    resolveImage,
  );
  const imagePos = page.imagePos ?? {};
  const template = getTemplate(page.templateId);
  const roleFor = (slot: string): AlbumTextRole | undefined => {
    const baseSlot = slot.replace(/\[\d+\]$/, '');
    return template?.texts.find((text) => text.id === baseSlot)?.role as AlbumTextRole | undefined;
  };

  // items 组的 bracket 路径(image[0]/explain[1]):adapt 已把值折进嵌套数组,
  // 这里为模板引用到的 bracket 槽补一份扁平键,下游 carrier/取值逻辑保持不变。
  for (const m of templateHtml.matchAll(TOKEN_RE)) {
    const slot = m[2]!.trim();
    if (!slot.includes('[') || data[slot] !== undefined) continue;
    const path = slot.match(/^([^[]+)\[(\d+)\]$/);
    if (!path) continue;
    const arr = data[path[1]!];
    const item = Array.isArray(arr) ? arr[Number(path[2]!)] : undefined;
    if (item !== undefined && (typeof item === 'string' || typeof item === 'number')) {
      data[slot] = item;
    }
  }

  return templateHtml.replace(TOKEN_RE, (_full, type: string, slotRaw: string, def?: string) => {
    const slot = slotRaw.trim();
    const fallback = def ?? '';
    switch (type) {
      case 'TEXT': {
        const carrier = resolveThemeCarrier(data, slot, roleFor(slot));
        return multilineHtml(escapeHtml(carrier.text ?? stringOf(data[slot])));
      }
      case 'COLOR': {
        const carrier = resolveThemeCarrier(data, slot, roleFor(slot));
        return escapeAttr(carrier.accentColor ?? fallback);
      }
      case 'FONT': {
        const carrier = resolveThemeCarrier(data, slot, roleFor(slot));
        return escapeAttr(carrier.webFontFamily ?? fallback);
      }
      case 'IMG_SRC': {
        // 空槽（用户删了图）或 resolveImage 解析不到时保留 token 原样:
        // 「图片 src 一律 token」是页面真相契约,烘焙器(web bake-html / design-agent
        // page-html)靠它把空槽也烘成 token;直接展示的调用方(page-html-dom /
        // render-raster)再把残留 token 解析成缺图占位。烘成 src="" 会让浏览器拿
        // 页面地址当图加载,渲成碎图标。
        const src = stringOf(data[slot]);
        return src ? escapeAttr(src) : `{{IMG_SRC:${slot}}}`;
      }
      case 'FIT_SIZE': {
        // 展示级大标题自适应字号:{{FIT_SIZE:slotId|boxWidth,maxSize,minSize}} → px 数值。
        // 与 React 版 fitDisplayFontSize 同一函数,web/PDF 两端字号一致。
        const carrier = resolveThemeCarrier(data, slot, roleFor(slot));
        const text = carrier.text ?? stringOf(data[slot]);
        const [w, max, min] = fallback.split(',').map((n) => Number(n.trim()));
        return String(fitDisplayFontSize(text, w || 400, max || 72, Number.isFinite(min) ? min : 44));
      }
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
  // 页底色是页级 carrier，不走 token 替换（模板里没有对应 token，53 个模板不可能挨个加）——
  // 填充完成后统一注入页根 style 末尾。无该键时 applyPageBackground 原样返回，老书零影响。
  return applyPageBackground(
    fillTemplateHtml(tpl, page, resolveImage),
    page.texts[PAGE_BACKGROUND_CARRIER_KEY],
  );
}

function stringOf(value: TemplateData[string]): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

// 换行渲染支持:文本节点里的 \n 会被 HTML 渲染折叠成空格,含换行的文案包一层
// white-space:pre-wrap 的 span。TEXT token 站在槽元素内容里、够不到父级开标签,
// 只能包内层;槽位标签只有 div/p/h1(见 html-templates),不会干扰 patchHtmlText/
// derivePageTexts 按「最近同名闭合标签」截取内容的假设。
function multilineHtml(escaped: string): string {
  if (!/[\r\n]/.test(escaped)) return escaped;
  return `<span style="white-space:pre-wrap">${escaped}</span>`;
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
