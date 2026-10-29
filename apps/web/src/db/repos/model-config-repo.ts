import { db } from '../client';
import { modelConfig } from '../schema';
import { eq } from 'drizzle-orm';

// 模型配置覆盖的 key 枚举(与管理后台「模型设置」页三条链路一一对应)。
export const MODEL_CONFIG_KEYS = ['compose_model', 'design_model', 'image_model'] as const;
export type ModelConfigKey = (typeof MODEL_CONFIG_KEYS)[number];

/** 读单条覆盖值;未配置返回 undefined(调用方回落 env 默认)。 */
export async function getModelOverride(key: ModelConfigKey): Promise<string | undefined> {
  const rows = await db.select().from(modelConfig).where(eq(modelConfig.key, key)).limit(1);
  return rows[0]?.value ?? undefined;
}

/** 读全部覆盖值(admin API 用)。 */
export async function getAllModelOverrides(): Promise<Record<string, string>> {
  const rows = await db.select().from(modelConfig);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** 写覆盖值(upsert);value 为 null 时删除(回落 env 默认)。 */
export async function setModelOverride(
  key: ModelConfigKey,
  value: string | null,
  updatedBy: string,
): Promise<void> {
  if (value === null) {
    await db.delete(modelConfig).where(eq(modelConfig.key, key));
    return;
  }
  await db
    .insert(modelConfig)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({
      target: modelConfig.key,
      set: { value, updatedAt: new Date(), updatedBy },
    });
}
