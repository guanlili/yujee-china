import { z } from 'zod';
import { TemplateCategory } from './enums';
import { PhotoOrientation, PhotoQuality } from './layout';
import {
  TEMPLATE_IDS as GENERATED_TEMPLATE_IDS,
  TEMPLATES as GENERATED_TEMPLATES,
} from './templates.generated';

// ── V3 迁移说明(WP0.1 ↔ WP0.2 耦合) ──────────────────────────────────────
// V3 模板契约(v3-requirements §9)= `category | pairing | images | svgs | texts
//   | items | variableDecor | hint`,**图片槽 quality/orientation 概念整体作废**。
// 但 `packages/contracts/templates/*.json` 仍是 legacy 形状(`slot`+`scene`、
//   图片槽带 `quality`/`orientation`、重复槽用 `repeat:true`、无 `svgs`/`items`/
//   `variableDecor`/`hint`),由模板维护方在 WP0.2(#177)收尾迁移。
// 故此处 schema 对 deprecated 字段一律「可选 + 容忍」:解析时接受、但 V3 逻辑不依赖,
//   保证 `pnpm --filter contracts test` 与 gen 脚本在 JSON 迁移完成前持续全绿。
// WP0.2 完成后需最终删除的字段清单见本文件 §DEPRECATED 注释 + issue #176 评论。

// Image slot: an addressable image position inside a template. `id` may be a
// bracket path ("cells[0].image") for repeat/grid layouts.
//
// @deprecated `orientation` / `quality` — V3 作废(§9):图片槽不带这两维,排图改由
//   select-template + 确定性兜底。**WP0.2 模板 JSON 完成迁移后删除这两个字段**。
//   过渡期保留为可选,容忍 legacy JSON。
export const TemplateImageSlot = z
  .object({
    id: z.string().min(1),
    orientation: z.array(PhotoOrientation).nonempty().optional(),
    quality: z.array(PhotoQuality).nonempty().optional(),
  })
  .strict();
export type TemplateImageSlot = z.infer<typeof TemplateImageSlot>;

// What kind of text this slot holds — drives how the LLM writes it. Writing
// guidance itself lives outside the template, keyed by this role.
export const TemplateTextRole = z.enum([
  'title',
  'body',
  'explain',
  'decoration',
]);
export type TemplateTextRole = z.infer<typeof TemplateTextRole>;

// Whether the text must be in the user's language or stays universal English
// (decoration like dates/numbers/labels defaults to en).
export const TemplateTextLang = z.enum(['user', 'en']);
export type TemplateTextLang = z.infer<typeof TemplateTextLang>;

export const TemplateTextSlot = z
  .object({
    id: z.string().min(1),
    role: TemplateTextRole,
    maxChars: z.number().int().positive().optional(),
    lang: TemplateTextLang,
    // V3:逐槽文案指引,透传给写作 LM(§4.2(4));模板维护方填,Agent 不自编。
    hint: z.string().min(1).max(200).optional(),
    // V3:渲染变量落点(§9)。standalone 装饰槽(章节色/艺术字字体/花字/点缀)
    //   被 `apply-theme` 一键刷;普通正文槽不带此标记、不被刷。
    variableDecor: z.boolean().optional(),
    // @deprecated `repeat` — V3 用 `items` 组承载重复内容(§9),不再用 repeat+bracket-path。
    //   **WP0.2 把 repeat 槽迁进 `items` 后删除此字段**。过渡期保留为可选。
    repeat: z.boolean().optional(),
  })
  .strict();
export type TemplateTextSlot = z.infer<typeof TemplateTextSlot>;

// V3:装饰矢量图槽(§9),花饰/分隔线/图标。`variableDecor:true` 的 svg 同样被
//   `apply-theme` 一键刷(章节色 / SVG 点缀)。
export const TemplateSvgSlot = z
  .object({
    id: z.string().min(1),
    variableDecor: z.boolean().optional(),
  })
  .strict();
export type TemplateSvgSlot = z.infer<typeof TemplateSvgSlot>;

// V3:唯一的「重复组」(一行/一格反复出现,§9),替代旧 `repeat:true` + bracket-path 键。
//   每组 `{ images:[{id}], texts:[{...}] }`;text 槽复用 `TemplateTextSlot` 的同一约束。
export const TemplateItems = z
  .object({
    images: z.array(TemplateImageSlot).optional(),
    texts: z.array(TemplateTextSlot).optional(),
  })
  .strict();
export type TemplateItems = z.infer<typeof TemplateItems>;

// @deprecated V3 用 `category`(TemplateCategory)替代 `slot` + `scene`(§9)。
//   **WP0.2 给每个模板补 `category`、删 `slot`/`scene` 后删除这两个 enum + 字段**。
// Where a template sits on the canvas. cover = head solo page, ending = tail
// solo page (both outside the spread system), interior = pages that pair.
export const TemplateSlotKind = z.enum(['cover', 'interior', 'ending']);
export type TemplateSlotKind = z.infer<typeof TemplateSlotKind>;

// @deprecated 同上(`scene`)。Content scenario, used to match a template.
export const TemplateScene = z.enum([
  'opening',
  'portrait',
  'scenery',
  'record',
  'interlude',
  'textOnly',
  'ending',
]);
export type TemplateScene = z.infer<typeof TemplateScene>;

// Forced spread pairing (print): this interior template must share a spread with
// `with`, sitting on `side`. Only valid when category/slot === 'interior'.
export const TemplatePairing = z
  .object({
    forced: z.boolean(),
    with: z.string().min(1),
    side: z.enum(['left', 'right']),
  })
  .strict();
export type TemplatePairing = z.infer<typeof TemplatePairing>;

export const TemplateDef = z
  .object({
    id: z.string().min(1),
    // V3:分类(§9),替代旧 slot+scene。过渡期可选——legacy JSON 还没补 category,
    //   WP0.2 迁移后改为必填(并删下面两个 deprecated 字段)。
    category: TemplateCategory.optional(),
    // @deprecated slot/scene — 见上,WP0.2 删除。过渡期保留容忍 legacy JSON。
    slot: TemplateSlotKind.optional(),
    scene: TemplateScene.optional(),
    pairing: TemplatePairing.nullable().optional(),
    styles: z.array(z.string().min(1)).optional(),
    images: z.array(TemplateImageSlot),
    // V3:装饰矢量图槽(可选,§9)。
    svgs: z.array(TemplateSvgSlot).optional(),
    texts: z.array(TemplateTextSlot),
    // V3:唯一重复组(可选,§9)。
    items: TemplateItems.optional(),
  })
  .strict();
export type TemplateDef = z.infer<typeof TemplateDef>;

export const TEMPLATES: Record<string, TemplateDef> = GENERATED_TEMPLATES;

export const TEMPLATE_IDS = [...GENERATED_TEMPLATE_IDS];

export const TemplateIdEnum = z.enum(TEMPLATE_IDS as [string, ...string[]]);

export function isKnownTemplate(id: string): boolean {
  return id in TEMPLATES;
}

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES[id];
}

export function validateSlotsForTemplate(
  templateId: string,
  imageSlotKeys: string[],
  textSlotKeys: string[],
): { ok: true } | { ok: false; reason: string } {
  const tpl = TEMPLATES[templateId];
  if (!tpl) return { ok: false, reason: `unknown templateId: ${templateId}` };

  const imageIds = new Set(tpl.images.map((slot) => slot.id));
  const textIds = new Set(tpl.texts.map((slot) => slot.id));
  // Repeat keys come from either the legacy `repeat:true` text slots or the V3
  // `items` group (both addressed via `base[i]` bracket paths).
  const repeatTextIds = new Set(tpl.texts.filter((slot) => slot.repeat).map((slot) => slot.id));
  const itemImageIds = new Set(tpl.items?.images?.map((slot) => slot.id) ?? []);
  const itemTextIds = new Set(tpl.items?.texts?.map((slot) => slot.id) ?? []);

  for (const k of imageSlotKeys) {
    const repeatBase = k.match(/^([A-Za-z0-9_-]+)\[\d+\]$/)?.[1];
    if (!imageIds.has(k) && !(repeatBase && itemImageIds.has(repeatBase))) {
      return {
        ok: false,
        reason: `image slot "${k}" not in template ${templateId}`,
      };
    }
  }

  for (const k of textSlotKeys) {
    const repeatBase = k.match(/^([A-Za-z0-9_-]+)\[\d+\]$/)?.[1];
    if (
      !textIds.has(k) &&
      !(repeatBase && (repeatTextIds.has(repeatBase) || itemTextIds.has(repeatBase)))
    ) {
      return {
        ok: false,
        reason: `text slot "${k}" not in template ${templateId}`,
      };
    }
  }

  return { ok: true };
}
