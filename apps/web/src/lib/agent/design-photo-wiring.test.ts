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

// ── 分享失配 warning 必须到得了用户眼前 ────────────────────────────────────
// seam 会算出 warning,但 design-agent 那侧工具 `terminate: true` 会掐断 agent 循环,
// 模型没机会把 notes 转述出来。所以这条链必须在 web 侧闭合:
//   applyAgentPhotoFilter → persistDesignChat 返回 → done 事件 → ChatPanel 显示。
// 断了任何一环,用户就会在零提示的情况下发现分享页照片全糊。

test('persistDesignChat 的返回类型带上 warnings', () => {
  const service = code('../../services/album/album-service.ts');
  assert.match(
    service,
    /persistDesignChat\([\s\S]{0,1800}?\):\s*Promise<\{[^}]*warnings[^}]*\}\s*\|\s*null>/,
  );
});

test('done 事件把 warnings 一起发给浏览器', () => {
  const route = code('../../app/api/v3/albums/[uuid]/design-chat/route.ts');
  assert.match(route, /type:\s*'done'[\s\S]{0,900}?warnings/);
});

test('ChatPanel 真的消费 done 里的 warnings 并渲染出来', () => {
  const panel = code('../../components/album/editor-v2/ChatPanel.tsx');
  // 解构/读取 done 载荷里的 warnings。
  assert.match(panel, /final\.warnings/);
  // 渲染成一张提示卡贴进对话(不是只存进变量)。
  assert.match(panel, /buildDesignWarningCard\(/);
  assert.match(panel, /stream\.host\.appendChild\(buildDesignWarningCard\(/);
  // 模型/服务端文案一律 textContent,绝不进 innerHTML(与工具入参同一条安全口径)。
  assert.match(panel, /function buildDesignWarningCard[\s\S]{0,900}?textContent/);
});

// ── 落库后的 photoFilter / settingsRevision 必须有人接 ──────────────────────
// 两个后果都是真的:
//   ① 调色后画板纹丝不动,用户要刷新才看得到(滤镜引擎只在 Browser 跑);
//   ② settingsRevisionRef 不更新 → 用户下一次改设置带着旧基线 → 必吃一次 409 回滚。
// 而纯调色那一轮 `committed` 恒 false,所以这条**绝不能**挂在 committed 里面。

test('ChatPanel 把 done 里的 photoFilter/settingsRevision 交给外壳,且不被 committed 挡住', () => {
  const panel = code('../../components/album/editor-v2/ChatPanel.tsx');
  assert.match(panel, /final\.photoFilter/);
  assert.match(panel, /final\.settingsRevision/);
  assert.match(panel, /onAgentPhotoFilter/);
  // ⚠️ 找的是**调用点**(`?.(`),不是那行 ref 赋值 —— 赋值在组件顶部,恒早于
  // committed 分支,拿它比位置等于把这条断言喂饱(mutation 实测:把调用点挪进
  // committed 分支里,断言仍绿)。
  const applyAt = panel.indexOf('onAgentPhotoFilterRef.current?.(');
  const committedAt = panel.indexOf('if (final.committed)');
  assert.ok(applyAt > 0, 'ChatPanel 应经 ref 调用外壳给的回调');
  assert.ok(committedAt > 0, 'committed 分支应仍在');
  assert.ok(
    applyAt < committedAt,
    '滤镜回填必须在 committed 分支之前 —— 纯调色那一轮 committed 恒 false',
  );
});

test('桌面壳把回调传给 ChatPanel,并同时推进三样本地状态', () => {
  const editor = code('../../components/album/editor-v2/EditorPort.tsx');
  assert.match(editor, /<ChatPanel[\s\S]{0,600}?onAgentPhotoFilter=\{/);
  // 回调体:推进设置基线 + 认账已持久化(否则防抖保存器会立刻把同一份再 PATCH 一遍)
  // + 把新状态灌进 React 状态(reloadPhotoFilter 的 effect 靠它触发重绘)。
  const body = /const onAgentPhotoFilter[\s\S]{0,900}?\n  \);/.exec(editor)?.[0] ?? '';
  assert.ok(body.length > 0, 'EditorPort 应定义 onAgentPhotoFilter');
  assert.match(body, /settingsRevisionRef\.current\s*=/);
  assert.match(body, /lastPersistedFilter\.current\s*=/);
  assert.match(body, /setPhotoFilter\(/);
});

test('移动壳同样接上 —— 否则手机上调色只能靠刷新', () => {
  const mobile = code('../../components/album/editor-v2/mobile/MobileEditorRoot.tsx');
  assert.match(mobile, /<ChatPanel[\s\S]{0,600}?onAgentPhotoFilter=\{/);
  const body = /const onAgentPhotoFilter[\s\S]{0,900}?\n  \);/.exec(mobile)?.[0] ?? '';
  assert.ok(body.length > 0, 'MobileEditorRoot 应定义 onAgentPhotoFilter');
  assert.match(body, /settingsRevisionRef\.current\s*=/);
  assert.match(body, /lastPersistedFilter\.current\s*=/);
  assert.match(body, /setPhotoFilter\(/);
});
