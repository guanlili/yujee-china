import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// 游客模式门禁的源码断言(照 my-albums-design.test.ts 的套路):
// 真实账号专属路由必须 requireRealUser;创作链路必须保持匿名可用(requireAuth/
// getAuthUser),不许被顺手改成 requireRealUser —— 那会把整个免登录流程堵死。

const API = join(import.meta.dirname, '../../app/api');

const REAL_ONLY = [
  'v3/albums/[uuid]/design-chat/route.ts', // 登录触发点①:Agent 对话打字
  'v1/albums/[uuid]/share/route.ts', // ②分享
  'v1/albums/[uuid]/photo-snapshot-upload-url/route.ts', // ③保存(云快照)
  'v1/albums/[uuid]/photo-snapshot/route.ts',
  'v1/albums/[uuid]/photo-originals/route.ts', // R2 写入面
  'v1/albums/[uuid]/photo-originals/upload-url/route.ts',
  'v1/albums/[uuid]/photo-originals/urls/route.ts',
  'v1/albums/[uuid]/pdf-upload-url/route.ts',
  'v1/albums/[uuid]/pdf/route.ts',
  'v1/albums/[uuid]/cover-thumbnail-upload-url/route.ts',
  'v1/albums/[uuid]/cover-thumbnail/route.ts',
  'v1/billing/checkout/route.ts', // 计费面
  'v1/credit/balance/route.ts',
  'v1/credit/history/route.ts',
  'v1/invite/redeem/route.ts',
  'v1/user/billing/route.ts',
  'v1/feedback/route.ts', // 邮件转发面,匿名可刷
];

const ANON_OK = [
  'v3/albums/route.ts', // 建相册(匿名分支在 service)
  'v3/albums/[uuid]/add-photos/route.ts',
  'v3/albums/[uuid]/chapter-context/route.ts', // 讲故事
  'v3/albums/[uuid]/story-progress/route.ts',
  'v3/albums/[uuid]/select-layout/route.ts',
  'v3/albums/[uuid]/design/route.ts', // 匿名走占位成稿
  'v3/albums/[uuid]/compose-append/route.ts', // 匿名返回 composed:false
  'v3/albums/[uuid]/draft/route.ts',
  'v3/albums/[uuid]/retry/route.ts',
  'v1/albums/[uuid]/route.ts', // 编辑器轮询
  'v1/albums/route.ts',
  'v1/albums/[uuid]/messages/route.ts',
  'v1/albums/[uuid]/chapters/route.ts',
  'v1/albums/[uuid]/pages/reorder/route.ts', // 无 AI 的编辑动作
  'v1/albums/[uuid]/pages/[idx]/route.ts',
  'v1/fonts/subset/route.ts',
  'v1/user/me/route.ts',
];

test('真实账号专属路由都挂 requireRealUser', () => {
  for (const rel of REAL_ONLY) {
    const src = readFileSync(join(API, rel), 'utf8');
    assert.match(src, /requireRealUser\(/, `${rel} 必须用 requireRealUser`);
    assert.doesNotMatch(src, /requireAuth\(/, `${rel} 不许再直接用 requireAuth`);
  }
});

test('创作链路保持匿名可用(requireAuth/getAuthUser,不许 requireRealUser)', () => {
  for (const rel of ANON_OK) {
    const src = readFileSync(join(API, rel), 'utf8');
    assert.match(
      src,
      /requireAuth\(|getAuthUser\(/,
      `${rel} 必须保留匿名可过的鉴权(requireAuth 或 getAuthUser)`,
    );
    assert.doesNotMatch(
      src,
      /requireRealUser/,
      `${rel} 是免登录创作链路,不许用 requireRealUser`,
    );
  }
});
