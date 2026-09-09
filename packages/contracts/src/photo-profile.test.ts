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
