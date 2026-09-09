import { z } from 'zod';

export const PHOTO_PROFILE_VERSION = 1 as const;

// ⚠️ 坐标系一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。
// 别用 [0,1] —— 两套坐标系并存必然出现 Agent 心算换算错误。
const Box = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(0).max(100),
  h: z.number().min(0).max(100),
}).strict();

export type PhotoBox = z.infer<typeof Box>;

/**
 * 照片视觉档案。存 `album_photos.profile` jsonb。
 *
 * ⚠️ 隐私红线(继承 v3-requirements §3):本 schema **不得**新增任何
 * location / place / GPS / lat / lng / coordinate 字段。`.strict()` 是这条
 * 红线的执行机制,改成 passthrough 等于拆掉红线。
 */
export const PhotoProfileSchema = z.object({
  v: z.literal(PHOTO_PROFILE_VERSION),

  // ── 几何组(RMBG mask 派生,确定性)──────────────────────────
  /** 主体包围盒。null = 没跑出主体(纯风景/抽象构图),此时 imagePos 走默认 50/50/1。 */
  subjectBox: Box.nullable(),
  /** 人脸框(0..n 个)。给 imagePos 的「别切脸」当硬约束。 */
  faceBoxes: z.array(Box).default([]),
  /**
   * alpha mask 的 R2 key。**默认 null** —— 建档时只取 mask 的包围盒,mask 本身
   * 丢弃不存:绝大多数照片不会被抠,一本 100 张的书预存 mask 是 5-20MB 净浪费。
   * 真要抠图时按需跑第二次推理并回填。
   */
  maskKey: z.string().nullable().default(null),

  // ── 色彩组(纯像素算法,不用模型)────────────────────────────
  colorTemp: z.enum(['warm', 'neutral', 'cool']),
  brightness: z.enum(['dark', 'mid', 'bright']),
  saturation: z.enum(['muted', 'normal', 'vivid']),
  /** 主色调,最多 3 个 6 位 hex。给 LUT 选择和配色协调用。 */
  dominantColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(3),

  // ── 语义组(豆包 vision,一次调用出全部)────────────────────
  /** 回填 V3ChapterPhoto.composition —— 这个字段现在恒 None,导致槽位构图约束失效。 */
  composition: z.enum(['closeup', 'focal', 'wide']),
  scene: z.enum(['indoor', 'outdoor', 'nature', 'city', 'interior']),
  peopleCount: z.enum(['0', '1', '2-3', '4+']),
  mood: z.enum(['warm', 'cool', 'sentimental', 'energetic', 'quiet']),
  /** 回填 V3ChapterPhoto.sceneDescription —— 这个字段现在恒空。不许写具体地名。 */
  description: z.string().max(300),
}).strict();

export type PhotoProfile = z.infer<typeof PhotoProfileSchema>;
