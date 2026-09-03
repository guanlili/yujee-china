import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StructureRevisionSchema } from './schema';

// 结构 OCC(Phase 2A)路由契约:DELETE /pages/[idx] 无 body,基线经
// ?baseStructureRevision=N 携带(coerce 解析)。这里钉住 query 值的解析口径:
// 必须是 [0, MAX_SAFE_INTEGER] 内的非负安全整数。

test('delete StructureRevisionSchema:合法基线通过并 coerce 成 number', () => {
  assert.deepEqual(StructureRevisionSchema.safeParse('0'), { success: true, data: 0 });
  assert.deepEqual(StructureRevisionSchema.safeParse('3'), { success: true, data: 3 });
});

test('delete StructureRevisionSchema:非法基线拒绝(负数/小数/超安全整数/非数字)', () => {
  assert.equal(StructureRevisionSchema.safeParse('-1').success, false);
  assert.equal(StructureRevisionSchema.safeParse('1.5').success, false);
  assert.equal(StructureRevisionSchema.safeParse(String(Number.MAX_SAFE_INTEGER + 1)).success, false);
  assert.equal(StructureRevisionSchema.safeParse('abc').success, false);
});
