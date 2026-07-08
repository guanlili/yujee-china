import { z } from 'zod';
import { TemplateCategory } from './enums';
import { PhotoComposition, PhotoOrientation, PhotoQuality } from './layout';
import {
  TEMPLATE_IDS as GENERATED_TEMPLATE_IDS,
  TEMPLATES as GENERATED_TEMPLATES,
} from './templates.generated';

// `items.images` grid templates declare one repeat image base in JSON. The V3
// selection/rendering path expands that base into exactly four addressable cells
// to preserve mag-10's existing 4-cell grid behavior.
export const ITEMS_GRID_CAPACITY = 4;

// ── 模板分类契约 ──────────────────────────────────────────────────────────
// V3 模板契约(v3-requirements §9):单一 `category`(cover|toc|interior|ending)
//   取代旧 `slot` + `scene`。`scene` 整体删除;模板选择不再做 scene 过滤,改为在
//   合法候选(图位数量能容纳本页照片)里按图位 orientation/quality 与照片特征做
//   **确定性**打分匹配。图片槽 `orientation`/`quality` 是这套图位特征匹配的输入,
//   故保留。

// Image slot: an addressable image position inside a template. `id` may be a
// bracket path ("cells[0].image") for repeat/grid layouts. `orientation` /
// `quality` describe what kind of photo the slot prefers — the deterministic
// template-selection / image-assignment scorer reads them to match real photos.
export const TemplateImageSlot = z
  .object({
    id: z.string().min(1),
    orientation: z.array(PhotoOrientation).nonempty().optional(),
    quality: z.array(PhotoQuality).nonempty().optional(),
    // 槽位接受的画面构图;未声明 = 接受任意(同 orientation/quality)。
    composition: z.array(PhotoComposition).nonempty().optional(),
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
    // V3:渲染变量落点(§9)。standalone 装饰槽(章节色/艺术字字体/花字/点缀)
    //   被 `apply-theme` 一键刷;普通正文槽不带此标记、不被刷。
    variableDecor: z.boolean().optional(),
    // 旧 `repeat:true` + bracket-path 的重复内容承载方式。V3 用 `items` 组替代,
    //   但当前引擎仍接受 repeat 槽的 bracket-path 寻址(见 validateSlotsForTemplate)。
    repeat: z.boolean().optional(),
    // 预览占位示例文案:用户未写文案时,Web 渲染用它占位(纯预览,不进 draft 数据)。
    sample: z.string().min(1).max(600).optional(),
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

// Forced spread pairing (print): this interior template must share a spread with
// `with`, sitting on `side`. Only valid when category === 'interior'.
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
    // V3:分类(§9),唯一分类字段,替代旧 slot+scene。
    category: TemplateCategory,
    pairing: TemplatePairing.nullable().optional(),
    styles: z.array(z.string().min(1)).optional(),
    images: z.array(TemplateImageSlot),
    // V3:装饰矢量图槽(可选,§9)。
    svgs: z.array(TemplateSvgSlot).optional(),
    texts: z.array(TemplateTextSlot),
    // V3:唯一重复组(可选,§9)。
    items: TemplateItems.optional(),
  })
  .strict()
  .superRefine((template, ctx) => {
    // pairing 只在 interior 有意义(cover/toc/ending 单独成页,不参与 spread 配对)。
    if (template.pairing && template.category !== 'interior') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pairing is only valid on interior templates',
        path: ['pairing'],
      });
    }
  });
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
  const fixedItemsGrid =
    tpl.images.length === 0 && itemImageIds.size === 1 ? ITEMS_GRID_CAPACITY : null;

  for (const k of imageSlotKeys) {
    const repeatKey = parseBracketKey(k);
    if (repeatKey && itemImageIds.has(repeatKey.base) && fixedItemsGrid !== null) {
      if (repeatKey.index >= fixedItemsGrid) {
        return {
          ok: false,
          reason: `image slot "${k}" exceeds items-grid capacity ${fixedItemsGrid} in template ${templateId}`,
        };
      }
    }
    if (!imageIds.has(k) && !(repeatKey && itemImageIds.has(repeatKey.base))) {
      return {
        ok: false,
        reason: `image slot "${k}" not in template ${templateId}`,
      };
    }
  }

  for (const k of textSlotKeys) {
    const repeatKey = parseBracketKey(k);
    if (repeatKey && itemTextIds.has(repeatKey.base) && fixedItemsGrid !== null) {
      if (repeatKey.index >= fixedItemsGrid) {
        return {
          ok: false,
          reason: `text slot "${k}" exceeds items-grid capacity ${fixedItemsGrid} in template ${templateId}`,
        };
      }
    }
    if (
      !textIds.has(k) &&
      !(repeatKey && (repeatTextIds.has(repeatKey.base) || itemTextIds.has(repeatKey.base)))
    ) {
      return {
        ok: false,
        reason: `text slot "${k}" not in template ${templateId}`,
      };
    }
  }

  return { ok: true };
}

function parseBracketKey(key: string): { base: string; index: number } | null {
  const match = key.match(/^([A-Za-z0-9_-]+)\[(\d+)\]$/);
  if (!match) return null;
  return { base: match[1], index: Number(match[2]) };
}
