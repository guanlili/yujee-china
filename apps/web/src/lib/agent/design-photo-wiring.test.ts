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

// ── 抠图渲染必须优先用服务端 mask ─────────────────────────────────────────
// 浏览器端那套是从四边漫水填充,没有语义(2026-08-29 实测棚拍人像 5 张 0 张能用,
// 自动抠图因此被否决)。Agent 现在能自动开抠图,渲染不接服务端 isnet 的分割结果,
// 用户拿到的就是一个被啃残的自己。

test('开抠图时在服务端把 mask 备好(写 R2 + 回填 maskKey)', () => {
  const service = code('../../services/album/album-service.ts');
  assert.match(service, /ensureCutoutMasks\(/);
  const mask = code('../../services/album/photo-mask-service.ts');
  // R2 写成功才回填 maskKey —— 指向不存在对象的 maskKey 比没有更糟。
  assert.match(mask, /putObject\([\s\S]{0,400}?maskKey:\s*key/);
  assert.match(mask, /photoMaskKey\(/);
});

test('渲染侧优先服务端 mask,没有才退回浏览器端', () => {
  const store = code('../../lib/photo/store.ts');
  assert.match(store, /setPhotoMaskFetcher/);
  // applyCutout 是唯一执行点:有 mask 走 applyMaskToBlob,没有才 applyToBlob。
  assert.match(store, /cutout\.mask[\s\S]{0,120}?applyMaskToBlob[\s\S]{0,120}?applyToBlob/);
  // 画板与导出走同一个执行点,两边才不会一个抠了一个没抠。
  assert.match(store, /getPdfDataUrls[\s\S]{0,2000}?applyCutout\(/);
});

test('先 LUT 再抠图的顺序不许被动过', () => {
  const store = code('../../lib/photo/store.ts');
  // 画板路径与导出路径都必须是 toned(LUT 之后)再进 applyCutout。
  // 只跳过函数**定义**那一处(形参叫 blob),其余每一个调用点都要查 ——
  // 放宽到「以 base 开头也算过」会把「先抠再调色」这个错误放行(mutation 实测)。
  const callSites = store.split('applyCutout(').slice(1)
    .filter((block) => !block.startsWith('blob: Blob'));
  assert.equal(callSites.length, 2, '画板与导出各一个调用点');
  for (const block of callSites) {
    assert.ok(block.startsWith('toned'), `applyCutout 的入参应是 LUT 之后的 toned,收到 ${block.slice(0, 24)}`);
  }
});

test('编辑器两个壳都注入 mask fetcher —— 少一个那一端就只有漫水填充', () => {
  const hook = code('../../lib/hooks/use-photo-mask-source.ts');
  assert.match(hook, /photoStore\.setPhotoMaskFetcher\(/);
  // 卸载/换相册必须收回:模块级单例槽位,残留的 fetcher 会替错的相册答题。
  assert.match(hook, /setPhotoMaskFetcher\(null\)/);
  for (const shell of [
    '../../components/album/editor-v2/EditorPort.tsx',
    '../../components/album/editor-v2/mobile/MobileEditorRoot.tsx',
  ]) {
    assert.match(code(shell), /usePhotoMaskSource\(/, `${shell} 应注入 mask fetcher`);
  }
});

// ── 手动抠图也走服务端 mask ───────────────────────────────────────────────
// 同一个按钮、同一本书,抠图质量不能取决于是人点的还是 Agent 干的(2026-09-10 拍板)。
// 手工那条走 settings PATCH,不能在 PATCH 里同步生成(isnet 单张 ~4s,用户点一下
// 等几十秒),所以是浏览器在滤镜存好之后**不等结果**地另打一枪。

test('手工路径有独立的触发口,photoIds 由服务端自己读,不收调用方清单', () => {
  const route = code('../../app/api/v1/albums/[uuid]/photo-masks/route.ts');
  assert.match(route, /ensureCutoutMasksForAlbum\(/);
  // 不解析请求体 —— 收清单等于给一个「替任意 photoId 烧推理」的口。
  assert.doesNotMatch(route, /parseBody|photoIds/);
  const service = code('../../services/album/photo-mask-service.ts');
  // 判据来自 albums.photo_filter.cutouts,与 Agent 那条路同一个 ensureCutoutMasks。
  assert.match(service, /ensureCutoutMasksForAlbum[\s\S]{0,600}?photoFilter\?\.cutouts/);
  assert.match(service, /ensureCutoutMasksForAlbum[\s\S]{0,700}?ensureCutoutMasks\(albumId/);
});

test('滤镜 PATCH 不生成 mask —— 它必须立刻返回', () => {
  const service = code('../../services/album/album-service.ts');
  const body = /async updatePhotoFilter\([\s\S]{0,1800}?\n  \},/.exec(service)?.[0] ?? '';
  assert.ok(body.length > 0, 'updatePhotoFilter 应存在');
  assert.doesNotMatch(body, /ensureCutoutMasks/, 'PATCH 里同步生成会让用户点一下等几十秒');
});

test('浏览器按「开着抠图的那批变了没有」触发,并且不等结果', () => {
  const hook = code('../../lib/hooks/use-photo-mask-source.ts');
  assert.match(hook, /cutoutSignature\(/);
  assert.match(hook, /requestCutoutMasks\(/);
  // fire-and-forget:不 await 阻塞渲染。
  assert.match(hook, /void \(async \(\)|\.then\(|void requestCutoutMasks/);
  // mask 到货后必须清掉「这张没有 mask」的记忆并让画面重来一次,否则整个会话都
  // 看不到好的那版(用户得刷新)。
  assert.match(hook, /forgetPhotoMasks\(/);
  assert.match(hook, /onMasksReady/);
});

test('两个壳都把当前滤镜和「重来一次」的回调交给 hook', () => {
  for (const shell of [
    '../../components/album/editor-v2/EditorPort.tsx',
    '../../components/album/editor-v2/mobile/MobileEditorRoot.tsx',
  ]) {
    const src = code(shell);
    assert.match(src, /usePhotoMaskSource\([\s\S]{0,200}?photoFilter/, `${shell} 应把当前滤镜传给 hook`);
    assert.match(src, /usePhotoMaskSource\([\s\S]{0,200}?onMasksReady/, `${shell} 应给 hook 一个重绘回调`);
  }
});

test('降级有声音:两种原因分开报', () => {
  const service = code('../../services/album/photo-mask-service.ts');
  assert.match(service, /clip-not-configured/);
  assert.match(service, /clip-call-failed/);
  // warn 级,不是 debug 一行;且带固定可检索前缀。
  assert.match(service, /logger\.warn\([\s\S]{0,240}?'cutout mask degraded/);
  const env = code('../../lib/env.ts');
  // 启动期也喊一次(不抛 —— 断网/worker 挂了时退回兜底仍强过整个抠不了)。
  assert.match(env, /productionWarnings/);
  assert.match(env, /AGENT_CLIP_BASE_URL/);
});
