import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDesignDonePayload } from './design-chat-done';

/**
 * 照片三工具的跨服务接线(web 这一半)。
 *
 * 协议:装书时把 photoFilter + hasPublishedShare + viewablePhotoIds 一起推给
 * design-agent;对话结束时它把**累计 patch** 带回来,web 调 applyAgentPhotoFilter
 * 在 album 行锁内落 albums.photo_filter。
 *
 * ⚠️ 源码正则守卫一律**先剥注释**再断言 —— 否则注释里提一句就把断言喂饱,假绿。
 * 本仓 2026-09-09 在 DESIGN_WRITE_TOOLS 上刚栽过一次。
 */

const here = dirname(fileURLToPath(import.meta.url));

export function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (quote) {
      if (char === '\\') {
        out += char + (next ?? '');
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

const code = (relative: string): string => stripComments(readFileSync(join(here, relative), 'utf8'));

test('剥注释的小工具本身是对的（否则守卫全是假绿）', () => {
  assert.equal(stripComments('a // photoFilterPatch\nb').includes('photoFilterPatch'), false);
  assert.equal(stripComments('a /* applyAgentPhotoFilter */ b').includes('applyAgentPhotoFilter'), false);
  assert.equal(stripComments('const x = "// still text";').includes('still text'), true);
});

// ── done 载荷:把累计 patch 捞出来 ────────────────────────────────────────

test('done 事件带回 photoFilterPatch 时原样取出', () => {
  const payload = buildDesignDonePayload({
    assistant: { text: '调好了' },
    committed: false,
    book: { pages: [] },
    photoFilterPatch: { default: { lutId: 'travel-cinematic', strength: 60 } },
  });
  assert.deepEqual(payload.photoFilterPatch, { default: { lutId: 'travel-cinematic', strength: 60 } });
});

test('没带 patch 时是 null —— web 据此决定要不要写 albums.photo_filter', () => {
  const payload = buildDesignDonePayload({ assistant: { text: 'ok' }, committed: false, book: { pages: [] } });
  assert.equal(payload.photoFilterPatch, null);
});

test('关抠图的 null 必须原样活下来', () => {
  const payload = buildDesignDonePayload({
    assistant: { text: 'ok' },
    committed: false,
    book: { pages: [] },
    photoFilterPatch: { cutouts: { p1: null } },
  });
  assert.equal((payload.photoFilterPatch as { cutouts: Record<string, unknown> }).cutouts.p1, null);
  assert.ok(!JSON.stringify(payload.photoFilterPatch).includes('false'));
});

test('patch 不是对象时当成没有，不把垃圾透传给落库层', () => {
  for (const bad of ['nope', 42, [], null]) {
    const payload = buildDesignDonePayload({
      assistant: { text: 'ok' },
      committed: false,
      book: { pages: [] },
      photoFilterPatch: bad,
    });
    assert.equal(payload.photoFilterPatch, null, `${JSON.stringify(bad)} 不该被当成 patch`);
  }
});

test('滤镜改动与 committed 互相独立 —— 滤镜不进 book.version', () => {
  const payload = buildDesignDonePayload({
    assistant: { text: '整本调成旅行大片' },
    committed: false,
    book: { pages: [{ pageIndex: 0, templateId: 'mag-01' }] },
    photoFilterPatch: { default: { lutId: 'travel-cinematic', strength: 60 } },
  });
  assert.equal(payload.committed, false);
  assert.notEqual(payload.photoFilterPatch, null);
});

// ── 接线守卫 ────────────────────────────────────────────────────────────

test('客户端装书时把相册语境一起推过去', () => {
  const client = code('design-agent-client.ts');
  assert.match(client, /hasPublishedShare/);
  assert.match(client, /viewablePhotoIds/);
});

test('客户端从 /api/chat 响应里取出 photoFilterPatch', () => {
  assert.match(code('design-agent-client.ts'), /photoFilterPatch/);
});

test('prepareDesignChat 真的算了这三样并传给 loadBook', () => {
  const service = code('../../services/album/album-service.ts');
  assert.match(service, /loadBook\([\s\S]{0,1200}?hasPublishedShare/);
  assert.match(service, /loadBook\([\s\S]{0,1200}?viewablePhotoIds/);
  assert.match(service, /loadBook\([\s\S]{0,1200}?photoFilter/);
});

test('persistDesignChat 用 applyAgentPhotoFilter 落库，不是自己写一遍 albums.photo_filter', () => {
  const service = code('../../services/album/album-service.ts');
  assert.match(service, /applyAgentPhotoFilter\(/);
});

test('流式路由把 photoFilterPatch 传给 persistDesignChat', () => {
  const route = code('../../app/api/v3/albums/[uuid]/design-chat/route.ts');
  assert.match(route, /persistDesignChat\([\s\S]{0,400}?photoFilterPatch/);
});

// ── 落库后的权威状态要回给前端 ─────────────────────────────────────────
// 滤镜是浏览器端渲染的(引擎只在 Browser 跑),画板要重绘就得知道新的 photoFilter。
// 权威值是 applyAgentPhotoFilter 落库后返回的那一份,不是 agent 内存里的副本
// (归一化、与并发写的合并都发生在落库那一步)。

test('persistDesignChat 的返回类型带上落库后的 photoFilter，不再是 void', () => {
  // 断言签名而不是局部变量名 —— 变量叫什么无关紧要,契约是「它把权威状态吐出来」。
  const service = code('../../services/album/album-service.ts');
  assert.match(service, /persistDesignChat\([\s\S]{0,1600}?\):\s*Promise<\{[^}]*photoFilter[^}]*\}\s*\|\s*null>/);
});

test('done 事件带上落库后的 photoFilter，前端才可能原地重绘', () => {
  const route = code('../../app/api/v3/albums/[uuid]/design-chat/route.ts');
  assert.match(route, /type:\s*'done'[\s\S]{0,700}?photoFilter/);
});

test('落库带上 baseSettingsRevision —— 漏传会让协作者调色每次必失败', () => {
  const service = code('../../services/album/album-service.ts');
  // prepareDesignChat 把基线吐出来
  assert.match(service, /prepareDesignChat\([^)]*\):\s*Promise<\{\s*baseSettingsRevision:\s*number\s*\}>/);
  // 落库时真的传给了 applyAgentPhotoFilter
  assert.match(service, /applyAgentPhotoFilter\([\s\S]{0,200}?input\.baseSettingsRevision/);
  // 流式路由把它从装书一路带到落库
  const route = code('../../app/api/v3/albums/[uuid]/design-chat/route.ts');
  assert.match(route, /baseSettingsRevision\s*\}\s*=\s*await\s+albumService\.prepareDesignChat/);
  assert.match(route, /persistDesignChat\([\s\S]{0,500}?baseSettingsRevision/);
});
