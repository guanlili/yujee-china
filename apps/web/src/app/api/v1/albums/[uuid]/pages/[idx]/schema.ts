import { z } from 'zod';

// 结构 OCC(Phase 2A):DELETE 无 body,基线经 ?baseStructureRevision=N 携带(与
// draft-changes 的 ?since 同款 query 解析口径)。
//
// 放在 route.ts 之外是硬性要求:Next.js 的 route 文件只允许导出 HTTP 方法和
// dynamic/revalidate/runtime 等固定配置项,多导出一个常量会让 next build 直接
// 失败("is not a valid Route export field")。tsc --noEmit 查不出来。
export const StructureRevisionSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
