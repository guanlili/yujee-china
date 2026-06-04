import { z } from 'zod';
import { PhotoOrientation, PhotoQuality } from './layout';
import {
  TEMPLATE_IDS as GENERATED_TEMPLATE_IDS,
  TEMPLATES as GENERATED_TEMPLATES,
} from './templates.generated.js';

export const TemplateSlotConstraint = z
  .object({
    orientation: z.array(PhotoOrientation).nonempty().optional(),
    quality: z.array(PhotoQuality).nonempty().optional(),
  })
  .strict();
export type TemplateSlotConstraint = z.infer<typeof TemplateSlotConstraint>;

export const TemplateTextSlotType = z.enum([
  'array',
  'caption',
  'heading',
  'label',
  'meta',
  'paragraph',
  'quote',
]);
export type TemplateTextSlotType = z.infer<typeof TemplateTextSlotType>;

export const TemplateTextSlotConstraint = z
  .object({
    type: TemplateTextSlotType,
    recommendedMaxChars: z.number().int().positive().optional(),
  })
  .strict();
export type TemplateTextSlotConstraint = z.infer<
  typeof TemplateTextSlotConstraint
>;

export const TemplateCategory = z.enum([
  'cover',
  'spread',
  'single',
  'grid',
  'closing',
]);
export type TemplateCategory = z.infer<typeof TemplateCategory>;

export const TemplateDef = z
  .object({
    id: z.string().min(1),
    category: TemplateCategory,
    styles: z.array(z.string().min(1)).optional(),
    imageSlots: z.record(z.string().min(1), TemplateSlotConstraint),
    textSlots: z.record(z.string().min(1), TemplateTextSlotConstraint),
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

  for (const k of imageSlotKeys) {
    if (!(k in tpl.imageSlots)) {
      return {
        ok: false,
        reason: `image slot "${k}" not in template ${templateId}`,
      };
    }
  }

  for (const k of textSlotKeys) {
    if (!(k in tpl.textSlots)) {
      return {
        ok: false,
        reason: `text slot "${k}" not in template ${templateId}`,
      };
    }
  }

  return { ok: true };
}
