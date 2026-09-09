import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhotoProfileSchema, PHOTO_PROFILE_VERSION } from './photo-profile.ts';

const valid = {
  v: 1,
  subjectBox: { x: 20, y: 10, w: 55, h: 70 },
  faceBoxes: [{ x: 30, y: 15, w: 20, h: 25 }],
  maskKey: null,
  colorTemp: 'warm',
  brightness: 'mid',
  saturation: 'normal',
  dominantColors: ['#C8A05A', '#2E3B4E'],
  composition: 'focal',
  scene: 'outdoor',
  peopleCount: '1',
  mood: 'warm',
  description: '傍晚海边,一个人背对镜头站在礁石上',
};

test('接受合法档案', () => {
  assert.equal(PhotoProfileSchema.parse(valid).v, PHOTO_PROFILE_VERSION);
});

test('坐标是 0-100 口径,超过 100 要拒', () => {
  assert.throws(() =>
    PhotoProfileSchema.parse({ ...valid, subjectBox: { x: 0.2, y: 0.1, w: 150, h: 0.7 } }),
  );
});

test('subjectBox 可以是 null(纯风景没有主体)', () => {
  assert.equal(PhotoProfileSchema.parse({ ...valid, subjectBox: null }).subjectBox, null);
});

// 隐私红线:schema 必须 strict,任何位置信息字段都要在 parse 期被拒
for (const key of ['location', 'place', 'gps', 'lat', 'lng', 'latitude', 'longitude', 'coordinate', 'coordinates']) {
  test(`拒绝位置信息字段 ${key}`, () => {
    assert.throws(
      () => PhotoProfileSchema.parse({ ...valid, [key]: 'anything' }),
      `${key} 必须在 parse 期被拒 —— 隐私红线`,
    );
  });
}

test('dominantColors 最多 3 个且必须是 6 位 hex', () => {
  assert.throws(() => PhotoProfileSchema.parse({ ...valid, dominantColors: ['#FFF'] }));
  assert.throws(() =>
    PhotoProfileSchema.parse({ ...valid, dominantColors: ['#112233', '#445566', '#778899', '#AABBCC'] }),
  );
});

test('faceBoxes 缺省是空数组', () => {
  const { faceBoxes: _omitted, ...withoutFaces } = valid;
  assert.deepEqual(PhotoProfileSchema.parse(withoutFaces).faceBoxes, []);
});

test('description 超过 300 字被拒', () => {
  assert.throws(() => PhotoProfileSchema.parse({ ...valid, description: '很长'.repeat(200) }));
});

// ── composition 可空(2026-09-09 评审后)──────────────────────────────
// 视觉调用失败/返回枚举外的值时,语义组落 null 而不是编一个 focal ——
// slot_matcher_v3 遇到 null 会「视作任意,不挡」,那是正确的降级;编个 focal
// 会让选版按错误的构图约束匹配。
// 这一侧不放宽的话,engine 侧那条降级会在 web 的逐条 safeParse 里被**整条拒绝**,
// 连色彩/几何一起丢 —— 降级等于白做。
test('composition 可以是 null(语义组降级)', () => {
  assert.equal(PhotoProfileSchema.parse({ ...valid, composition: null }).composition, null);
});

test('composition 仍然拒绝枚举外的字符串', () => {
  assert.throws(() => PhotoProfileSchema.parse({ ...valid, composition: 'panorama' }));
});

test('composition 缺省即 null,不是报错', () => {
  const { composition: _omitted, ...without } = valid;
  assert.equal(PhotoProfileSchema.parse(without).composition, null);
});
