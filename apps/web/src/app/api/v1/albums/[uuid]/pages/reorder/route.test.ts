import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BodySchema } from './schema';

// 结构 OCC(Phase 2A)路由契约:reorder body 的 baseStructureRevision 给了就必须是
// [0, MAX_SAFE_INTEGER] 内的非负安全整数;**省略是发布阶段 A 的过渡态**(主站前端在
// 协同 UI 落地前不发这个字段,设成必填会让 owner 自己也挪不了页)—— 省略时 owner
// 走旧盲写、editor 一律被 service 拒。
//
// 这里只钉 zod 形状。语义层(失配 409 零写入、editor 省略被拒)在
// services/collaboration/collaboration-service.test.ts 的 OCC 用例里覆盖。

test('reorder BodySchema:合法置换 + 基线通过', () => {
  const parsed = BodySchema.safeParse({ permutation: [0, 2, 1], baseStructureRevision: 0 });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('reorder BodySchema:缺 baseStructureRevision → 放行(阶段 A 的旧客户端)', () => {
  // 拒绝会让主站现有前端(EditorPort / MobileEditorRoot 都不发这个字段)全部 400。
  // 协同并发的安全性由 service 的「editor 省略即拒」守,不靠这条 schema。
  assert.equal(BodySchema.safeParse({ permutation: [0, 2, 1] }).success, true);
});

test('reorder BodySchema:基线非法 → 拒(负数/小数/超安全整数)', () => {
  assert.equal(BodySchema.safeParse({ permutation: [0, 2, 1], baseStructureRevision: -1 }).success, false);
  assert.equal(BodySchema.safeParse({ permutation: [0, 2, 1], baseStructureRevision: 1.5 }).success, false);
  assert.equal(
    BodySchema.safeParse({ permutation: [0, 2, 1], baseStructureRevision: Number.MAX_SAFE_INTEGER + 1 }).success,
    false,
  );
});

test('reorder BodySchema:置换形状仍被把关(空/单元素)', () => {
  assert.equal(BodySchema.safeParse({ permutation: [], baseStructureRevision: 0 }).success, false);
  assert.equal(BodySchema.safeParse({ permutation: [0], baseStructureRevision: 0 }).success, false);
});
