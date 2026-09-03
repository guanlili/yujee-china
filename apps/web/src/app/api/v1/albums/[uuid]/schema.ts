import { z } from 'zod';
import { PhotoFilterStateSchema } from '@/lib/photo/filter-state';

const BoardBackgroundSchema = z.union([
  z.object({ kind: z.literal('color'), color: z.string().max(9) }).strict(),
  z.object({ kind: z.literal('preset'), presetId: z.string().max(40) }).strict(),
  z.object({ kind: z.literal('upload'), key: z.string().max(64) }).strict(),
  z.null(),
]);

export const AlbumPatchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    boardBackground: BoardBackgroundSchema.optional(),
    photoFilter: PhotoFilterStateSchema.nullable().optional(),
    // 全局创作设置 OCC 基线(Phase 2B):客户端所见 settingsRevision,与 title/
    // 背景/滤镜的更新基线精确比较。
    //
    // **可选是发布阶段 A 的过渡态**,与 updatePage 的 baseVersion 同一口径:主站
    // 前端(EditorPort / MobileEditorRoot)在协同 UI 落地前不发这个字段,设成必填
    // 会让 owner 自己改书名/背景/滤镜全部 400。服务端的口径是「owner 不带走旧
    // 盲写,editor 不带一律拒绝」—— 协同场景的安全性不依赖这个 schema。
    // 前端全部带上后收紧为必填。
    baseSettingsRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()
  .refine(
    (body) =>
      [body.title, body.boardBackground, body.photoFilter].filter(
        (value) => value !== undefined,
      ).length === 1,
    { message: 'exactly one field must be updated' },
  );
