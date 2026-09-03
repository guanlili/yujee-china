import { z } from 'zod';

// 整页交换的原子落库(2026-08-01 设计)。permutation[newIndex] = oldIndex,
// 必须是 0..n-1 的完整双射;双射性/锚定页(cover·toc·ending 不许动)在
// albumService.reorderPages 的事务里校验 —— 这里只做形状检查。
//
// 放在 route.ts 之外是硬性要求:Next.js 的 route 文件只允许导出 HTTP 方法和
// dynamic/revalidate/runtime 等固定配置项,多导出一个常量会让 next build 直接
// 失败("is not a valid Route export field")。tsc --noEmit 查不出来。
export const BodySchema = z.object({
  permutation: z.array(z.number().int().nonnegative()).min(2),
  // 结构 OCC(Phase 2A):客户端所见的结构版本基线。服务端精确比较,失配 409。
  // 可选是发布阶段 A 的过渡态(同 baseVersion / baseSettingsRevision):owner 旧
  // 客户端不带走旧盲写,editor 不带一律拒绝。前端带上后收紧为必填。
  baseStructureRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
