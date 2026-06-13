import { z } from 'zod';
import { PhotoOrientation, PhotoQuality } from './layout';
import {
  TEMPLATE_IDS as GENERATED_TEMPLATE_IDS,
  TEMPLATES as GENERATED_TEMPLATES,
} from './templates.generated';

// Image slot: an addressable image position inside a template. `id` may be a
// bracket path ("cells[0].image") for repeat/grid layouts.
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
    // Repeat slots ("items", "cells") hold an array of sub-items; the renderer
    // (adapt-layout) rebuilds them into a real array.
    repeat: z.boolean().optional(),
  })
  .strict();
export type TemplateTextSlot = z.infer<typeof TemplateTextSlot>;

// Where a template sits on the canvas. cover = head solo page, ending = tail
// solo page (both outside the spread system), interior = pages that pair.
export const TemplateSlotKind = z.enum(['cover', 'interior', 'ending']);
export type TemplateSlotKind = z.infer<typeof TemplateSlotKind>;

// Content scenario, used to match a template to what it should hold.
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
// `with`, sitting on `side`. Only valid when slot === 'interior'.
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
    slot: TemplateSlotKind,
    scene: TemplateScene,
    pairing: TemplatePairing.nullable().optional(),
    styles: z.array(z.string().min(1)).optional(),
    images: z.array(TemplateImageSlot),
    texts: z.array(TemplateTextSlot),
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

  for (const k of imageSlotKeys) {
    if (!imageIds.has(k)) {
      return {
        ok: false,
        reason: `image slot "${k}" not in template ${templateId}`,
      };
    }
  }

  for (const k of textSlotKeys) {
    if (!textIds.has(k)) {
      return {
        ok: false,
        reason: `text slot "${k}" not in template ${templateId}`,
      };
    }
  }

  return { ok: true };
}
