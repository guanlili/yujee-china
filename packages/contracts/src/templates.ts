import { z } from 'zod';
import { PhotoOrientation, PhotoQuality } from './layout';

export const TemplateSlotConstraint = z.object({
  orientation: z.array(PhotoOrientation).optional(),
  quality: z.array(PhotoQuality).optional(),
});

export const TemplateCategory = z.enum(['cover', 'spread', 'single', 'grid', 'closing']);

export const TemplateDef = z.object({
  id: z.string(),
  category: TemplateCategory,
  imageSlots: z.record(z.string(), TemplateSlotConstraint),
  textSlots: z.array(z.string()),
});
export type TemplateDef = z.infer<typeof TemplateDef>;

/**
 * 21 模板注册表 —— Agent composing 阶段的**唯一可选集合**。
 *
 * 当前只是占位骨架(B-1 任务):
 *   - 真实 slot / orientation / quality 约束需要从 https://github.com/yvaineyu9/memoir
 *     的 frontend/schema.js 抽出来填入
 *   - 抽取方法:clone memoir 仓库 → 读 frontend/schema.js → 21 个模板的 schemaRegistry 里
 *     每个模板的 imageSlots 和 textSlots 翻译过来
 *   - 翻译完成前,Agent composing 阶段只能选 cover-01 / spread-01 / spread-02 三个占位项,
 *     mock pipeline 就是这么做的
 *
 * 完整 21 模板交付前不允许声明"B8 模板合并"完成。
 */
export const TEMPLATES: Record<string, TemplateDef> = {
  'cover-01': {
    id: 'cover-01',
    category: 'cover',
    imageSlots: { hero: { orientation: ['landscape'], quality: ['hero'] } },
    textSlots: ['title', 'subtitle'],
  },
  'spread-01': {
    id: 'spread-01',
    category: 'spread',
    imageSlots: {
      left: {},
      right: {},
    },
    textSlots: ['caption'],
  },
  'spread-02': {
    id: 'spread-02',
    category: 'spread',
    imageSlots: {
      hero: { quality: ['hero', 'detail'] },
      fill: {},
    },
    textSlots: ['caption'],
  },
  // TODO B-1: 添加剩余 18 个模板,从 yvaineyu9/memoir frontend/schema.js 抽
  //   - mag-01 ~ mag-21 全部
  //   - p01 暗色人像
  //   - 每个模板的 imageSlots 必须填 orientation / quality 约束(没有约束则空对象)
  //   - 每个模板的 textSlots 必须列出所有可填 key
  //   - category 按"封面 / 跨页双图 / 单图 / 网格 / 收尾" 五类归
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export const TemplateIdEnum = z.enum(
  TEMPLATE_IDS as [string, ...string[]],
);

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
    if (!(k in tpl.imageSlots)) return { ok: false, reason: `image slot "${k}" not in template ${templateId}` };
  }
  for (const k of textSlotKeys) {
    if (!tpl.textSlots.includes(k)) return { ok: false, reason: `text slot "${k}" not in template ${templateId}` };
  }
  return { ok: true };
}
