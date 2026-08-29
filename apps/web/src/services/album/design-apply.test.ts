import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_BACKGROUND_CARRIER_KEY } from '@yujee/contracts';
import {
  assembleDesignedPages,
  darkInkByPageIndex,
  buildCoverSets,
  coverTextBase,
  pickHeroPhotos,
  sweepCarriers,
  templateCategory,
} from './design-apply';
import {
  interiorInkSequence,
  legacyInteriorInkSequence,
  THIRD_SET_INK,
} from '@/lib/design/third-set-palette';

const CHAPTERS = [
  { photos: [{ photoId: 'pw', composition: 'wide' }, { photoId: 'pf', composition: 'focal' }] },
  { photos: [{ photoId: 'pc', composition: 'closeup' }] },
];

const FONTS = { title: 'zcool-xiaowei', body: 'lxgw-wenkai', decoration: 'smiley-sans' };
const COLORS = { title: '#2b4a6f', body: '#1c1b18', explain: '#6b675f' };

test('coverTextBase: 只给 title 槽留 sample 兜底,其余槽宁可空着', () => {
  const base = coverTextBase('mag-23');
  assert.equal(base.title, 'NORWAY');
  assert.equal(base.title2, 'Record'); // mag-23 有两个 title 角色的槽,都该留 sample
  assert.equal(base.body, undefined);   // sample 是 "2026\n2025\n2024",别人的年份
  assert.equal(base.body2, undefined);  // sample 是 "Shanghai \nBeijing\nDali"
});

test('designAppliedMarker: 真成稿与占位成稿写同一形状(底色/配色不能只有一边记)', async () => {
  const { designAppliedMarker } = await import('./design-apply');
  const base = {
    coverTemplateId: 'mag-62',
    coverPhotoId: 'p1',
    endingTemplateId: 'mag-22',
    endingPhotoId: 'p2',
  };
  // 回放回执卡靠这两个键把第三套的深色封面染对(缺了就按浅底渲,粉标题 1.7:1)。
  assert.deepEqual(designAppliedMarker({ ...base, pageBackground: '#F1F2F0', coverColorway: 'teal' }), {
    ...base,
    pageBackground: '#F1F2F0',
    coverColorway: 'teal',
  });
  // 没有就不写键(老书/其余三套形状不变)。
  assert.deepEqual(designAppliedMarker(base), base);
});

test('pickHeroPhotos: 构图 focal > closeup > 其余', () => {
  assert.deepEqual(pickHeroPhotos(CHAPTERS, 2), ['pf', 'pc']);
});

test('buildCoverSets: 固定顺序,不随 albumId 变', () => {
  const a = buildCoverSets('album-1', CHAPTERS);
  const b = buildCoverSets('album-2', CHAPTERS);
  assert.equal(a.length, 4);
  assert.deepEqual(a.map((s) => s.coverTemplateId), b.map((s) => s.coverTemplateId));
});

test('buildCoverSets: 第三套是深色套 —— mag-62 封面 + mag-63 封底 + 派定的配色', async () => {
  const { THIRD_SET_COVER_TEMPLATE_ID, coverColorwayById } = await import('@/lib/design/third-set-palette');
  const sets = buildCoverSets('album-1', CHAPTERS);
  assert.equal(sets[2]!.coverTemplateId, THIRD_SET_COVER_TEMPLATE_ID, '第 3 套必须是深色椭圆封面');
  assert.equal(sets[2]!.endingTemplateId, 'mag-63', '第 3 套配纯装饰封底(零槽位,无 AI 结语)');
  assert.ok(coverColorwayById(sets[2]!.coverColorway), '第 3 套要派一个真实存在的配色');
  // 另外三套不受影响:没有配色,封底仍是 mag-22(5 个文字槽,AI 结语照常有地方落)。
  for (const i of [0, 1, 3]) {
    assert.equal(sets[i]!.coverColorway, undefined, `第 ${i + 1} 套不该带配色`);
    assert.equal(sets[i]!.endingTemplateId, 'mag-22', `第 ${i + 1} 套封底应仍是 mag-22`);
  }
  assert.equal(sets[0]!.pageBackground, '#FFFFFF');
  // 只放 id 字符串:整张色表泄进 CoverSet 就会被前端一路带进 POST /design 的
  // .strict() 请求体里(本分支已经这么炸过一次,4fa211fe)。
  for (const s of sets) {
    for (const [, v] of Object.entries(s)) assert.equal(typeof v, 'string');
  }
});

test('coverColorwayForAlbum: 按 albumId 确定性派定(同一本书永远同一个色)', async () => {
  // 直接测派色函数本身,不经过 SET_LAYOUT —— 这样第三套开关的状态不影响这条契约,
  // 开启那天不用再改这条测试。
  const { coverColorwayForAlbum, coverColorwayById } = await import('@/lib/design/third-set-palette');
  assert.equal(coverColorwayForAlbum('album-1').id, coverColorwayForAlbum('album-1').id,
    '同一本书两次取到的配色必须一致(随机=刷新就换色,是 bug)');
  assert.ok(coverColorwayById(coverColorwayForAlbum('album-1').id), '派出来的必须是真实存在的配色');
  const ids = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => coverColorwayForAlbum(x).id));
  assert.ok(ids.size >= 2, '不同相册应当散到不同配色');
});

test('buildCoverSets: 封底逐套显式声明(SET_LAYOUT 表),不再按 albumId 哈希', () => {
  const a = buildCoverSets('album-1', CHAPTERS);
  const b = buildCoverSets('album-2', CHAPTERS);
  assert.deepEqual(a.map((s) => s.endingTemplateId), b.map((s) => s.endingTemplateId));
  for (const s of a) assert.equal(templateCategory(s.endingTemplateId), 'ending');
});

// 补测(评审 Important):buildCoverSets 里 `PAGE_BACKGROUNDS[i % ...]` 这行这次没改,
// 但被替换掉的旧测试连带删掉了对它的唯一覆盖 —— 全仓没有 page-backgrounds.test.ts,
// 补回来防止这行退化(比如误改成恒定同一色)没有测试兜底。
test('buildCoverSets: 每套绑定一个书页底色,4 套 × 4 色一一对应', async () => {
  const { PAGE_BACKGROUNDS } = await import('@/lib/design/page-backgrounds');
  const sets = buildCoverSets('album-1', CHAPTERS);
  assert.equal(sets.length, 4);
  sets.forEach((s, i) => assert.equal(s.pageBackground, PAGE_BACKGROUNDS[i]!.hex));
  assert.equal(new Set(sets.map((s) => s.pageBackground)).size, 4);
});

test('sweepCarriers: 按 role 写 #artFont/#accentColor,decoration 色跟标题色', () => {
  const pages = sweepCarriers(
    [{ pageIndex: 0, templateId: 'mag-15', images: { main: 'p1' }, texts: { title: 'T' } }],
    FONTS,
    COLORS,
  );
  const texts = pages[0].texts;
  assert.equal(texts['title#artFont'], 'zcool-xiaowei');
  assert.equal(texts['title#accentColor'], '#2b4a6f');
  assert.equal(texts['title'], 'T'); // 原文案不动
  // mag-15 若有 body/explain/decoration 槽则同样被刷(存在才断言)。
  for (const [key, value] of Object.entries(texts)) {
    if (key.endsWith('#artFont')) assert.ok(['zcool-xiaowei', 'lxgw-wenkai', 'smiley-sans'].includes(value));
  }
});

// 缺口 1(task-15):items 组文字槽(mag-10 的 explain[i])此前不在 sweepCarriers
// 的遍历范围内 —— 只扫 template.texts,items.texts 整组漏掉,carrier 键从未写出,
// 深色套上这些槽只能落到模板 token 默认色(黑),深底黑压黑。渲染端认 bracket 路径
// `explain[0]` 这个键形状(fill-template.ts roleFor 剥 [n] 回查、adapt-layout 直接
// 透传 #accentColor 结尾的键),缺的只是这里没写。
test('sweepCarriers: items 组文字槽(mag-10 的 explain[i])也要写 #accentColor/#artFont(缺口 1)', () => {
  const pages = sweepCarriers(
    [{ pageIndex: 0, templateId: 'mag-10', images: {}, texts: {} }],
    FONTS,
    COLORS,
  );
  const texts = pages[0].texts;
  // mag-10 的 items.images 固定展开 4 格(ITEMS_GRID_CAPACITY),explain[i] 与之一一对应。
  for (let i = 0; i < 4; i += 1) {
    assert.equal(texts[`explain[${i}]#accentColor`], COLORS.explain);
    assert.equal(texts[`explain[${i}]#artFont`], FONTS.body); // explain 角色字体跟 body
  }
});

test('assembleDesignedPages: 页序 [封面,...内页,封尾] 且 pageIndex 重排、carrier 已刷', () => {
  const sets = buildCoverSets('album-1', CHAPTERS);
  const set = sets[0];
  const pages = assembleDesignedPages({
    interiorPages: [
      { pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} },
      { pageIndex: 1, templateId: 'mag-34', images: { i1: 'pc' }, texts: {} },
    ],
    set,
    coverTexts: { title: '海边的夏天' },
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
  });
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.map((p) => p.pageIndex), [0, 1, 2, 3]);
  assert.equal(templateCategory(pages[0].templateId), 'cover');
  assert.equal(templateCategory(pages[3].templateId), 'ending');
  assert.equal(pages[0].texts['title'], '海边的夏天');
  assert.equal(Object.values(pages[0].images)[0], set.coverPhotoId);
  assert.equal(Object.values(pages[3].images)[0], set.endingPhotoId);
});

// ── 书页底色(2026-07 设计环节叠加) ──

// 页根开标签 = html 里第一个带 data-template 的元素(与 patchHtmlPageStyle 同锚点)。
const rootTag = (html?: string) =>
  /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html ?? '')?.[0] ?? '';

test('assembleDesignedPages: 书页底色(非纯白)刷进每页页根 background-color', () => {
  const set = buildCoverSets('album-1', CHAPTERS)[0];
  const pages = assembleDesignedPages({
    interiorPages: [
      { pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} },
      { pageIndex: 1, templateId: 'mag-34', images: { i1: 'pc' }, texts: {} },
    ],
    set,
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    pageBackground: '#FBF8F1',
  });
  assert.equal(pages.length, 4); // 封面+2内页+封尾:全书每页都刷
  for (const p of pages) {
    assert.match(rootTag(p.html), /background-color:#FBF8F1/i, `页 ${p.pageIndex} 页根应有底色`);
  }
});

test('assembleDesignedPages: 纯白/未传底色 → 页根不写 inline background-color(留模板默认)', () => {
  const set = buildCoverSets('album-1', CHAPTERS)[0];
  const base = {
    interiorPages: [{ pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} }],
    set,
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
  };
  const white = assembleDesignedPages({ ...base, pageBackground: '#FFFFFF' });
  const none = assembleDesignedPages(base);
  for (const p of [...white, ...none]) {
    assert.doesNotMatch(rootTag(p.html), /background-color/i, '纯白/未传不该写 inline 背景');
  }
});

test('assembleDesignedPages: 页底色同时写进 #pageBackground carrier(重烘才拿得回来)', () => {
  const set = buildCoverSets('album-1', CHAPTERS)[0];
  const pages = assembleDesignedPages({
    interiorPages: [
      { pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} },
      { pageIndex: 1, templateId: 'mag-34', images: { i1: 'pc' }, texts: {} },
    ],
    set,
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    pageBackground: '#FBF8F1',
  });
  assert.equal(pages.length, 4);
  for (const page of pages) {
    assert.equal(page.texts[PAGE_BACKGROUND_CARRIER_KEY], '#FBF8F1', '缺 carrier:Agent 重烘这页时底色就丢了');
    assert.ok(page.html!.includes('background-color:#FBF8F1'), 'inline 那条老路也要照旧');
  }
});

test('assembleDesignedPages: 纯白仍视为无底色,carrier 和 inline 都不写(对老书纯叠加)', () => {
  const set = buildCoverSets('album-1', CHAPTERS)[0];
  const base = {
    interiorPages: [{ pageIndex: 0, templateId: 'mag-15', images: { main: 'pw' }, texts: {} }],
    set,
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
  };
  const white = assembleDesignedPages({ ...base, pageBackground: '#FFFFFF' });
  const none = assembleDesignedPages(base);
  for (const p of [...white, ...none]) {
    assert.equal(p.texts[PAGE_BACKGROUND_CARRIER_KEY], undefined);
  }
});

// ── 封尾模板与多图槽(2026-07 封面封尾调整) ──

test('pickEndingTemplateId: 优先带文字槽的封底,engine 封尾文案有槽可落', async () => {
  const { pickEndingTemplateId } = await import('./design-apply');
  const { TEMPLATES } = await import('@yujee/contracts');
  for (const albumId of ['album-a', 'album-b', 'album-c', 'x']) {
    const id = pickEndingTemplateId(albumId)!;
    const t = (TEMPLATES as Record<string, { category?: string; texts?: unknown[] }>)[id];
    assert.equal(t.category, 'ending');
    assert.ok((t.texts ?? []).length > 0, `${id} 应有文字槽(纯图 mag-20 不该被选)`);
  }
});

test('assembleDesignedPages: 封底多图槽全部填上,第 1 槽是 endingPhotoId', async () => {
  const { assembleDesignedPages, pickEndingTemplateId } = await import('./design-apply');
  const { TEMPLATES } = await import('@yujee/contracts');
  const endingId = pickEndingTemplateId('album-a')!;
  const endingSlots = ((TEMPLATES as Record<string, { images?: { id: string }[] }>)[endingId].images ?? []).map((s) => s.id);
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {} }],
    set: { coverTemplateId: 'mag-32', coverPhotoId: 'hero-1', endingTemplateId: endingId, endingPhotoId: 'hero-2' },
    coverTexts: {},
    endingTexts: {},
    fonts: { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' },
    colors: { title: '#111', body: '#222', explain: '#333' },
    extraEndingPhotoIds: ['hero-3', 'hero-4'],
  });
  const ending = pages[pages.length - 1];
  assert.equal(ending.templateId, endingId);
  assert.equal(Object.keys(ending.images).length, endingSlots.length, '图槽一个不落');
  assert.equal(ending.images[endingSlots[0]], 'hero-2');
  if (endingSlots.length > 1) {
    assert.equal(ending.images[endingSlots[1]], 'hero-3'); // 补充照片按序进后续槽
  }
});

// ── 第三套深色内页配色(2026-08 三套体系) ──

test('assembleDesignedPages: 带 colorway 时内页按 3 组深底循环,页根刷底色和字色', () => {
  const interior = [0, 1, 2, 3].map((i) => ({
    pageIndex: i,
    templateId: 'mag-08',
    images: {},
    texts: { note: '文' },
  }));
  const pages = assembleDesignedPages({
    interiorPages: interior as never,
    set: {
      coverTemplateId: 'mag-62',
      coverPhotoId: 'p1',
      endingTemplateId: 'mag-22',
      endingPhotoId: 'p2',
    },
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    interiorSeed: 'album-seed-1',
    // cream:底色 #F9EDC4 与五个内页底色都不重合 —— 撞上的话「封面/封尾没占用内页
    // 随机序列」这件事就只能间接推,断不出来。
    colorway: { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
  });
  // 页序 [封面, 内页×4, 封尾];内页从 index 1 开始,按 seed 派的序列逐页刷。
  const seq = interiorInkSequence('album-seed-1', 4);
  for (let i = 0; i < 4; i += 1) {
    const ink = seq[i]!;
    assert.match(pages[i + 1]!.html!, new RegExp(`background-color:\\s*${ink.bg}`, 'i'), `第 ${i + 1} 页底色`);
    // per-page 字色真的经 carrier 写进了 html —— 只断页根底色的话,把
    // assembleDesignedPages 里喂给 sweepCarriers 的回调改成恒定返回 input.colors
    // (等于废掉「sweepCarriers 第三参数放宽」这件事本身)也能全绿,这条才钉得住。
    assert.match(pages[i + 1]!.html!, new RegExp(ink.accent, 'i'), `第 ${i + 1} 页字色`);
  }
  // 封面/封尾用 colorway 的底色,不参与内页随机 —— 没有占用序列里的位置
  assert.match(pages[0]!.html!, /background-color:\s*#F9EDC4/i);
  assert.match(pages[5]!.html!, /background-color:\s*#F9EDC4/i); // 封尾此前从未被断言过
});

// 缺口(评审前自查):TEMPLATE_OWN_BACKGROUND(design-agent tools.ts)只兜得住模板自带
// 的固定深底(mag-62/63/p01 的 CSS 默认值 #12363A/#1C1B18),兜不住这里 —— 深色套的
// 实际底色是 colorway/interiorInkSequence 动态派的(封面可能是浅底 butter #F3F0A8),
// 不写 carrier 的话 effectivePageBackground 会拿到模板默认深底去做对比度校验,浅底页
// 会被误判成深底,c3ce69b3 那道硬校验对刚成稿的深色套书形同虚设。
test('assembleDesignedPages: 深色套(colorway)每页底色也写进 #pageBackground carrier(否则对比度校验会读错底色)', () => {
  const interior = [0, 1, 2, 3].map((i) => ({
    pageIndex: i,
    templateId: 'mag-08',
    images: {},
    texts: {},
  }));
  const colorway = { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' };
  const pages = assembleDesignedPages({
    interiorPages: interior as never,
    set: { coverTemplateId: 'mag-62', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    interiorSeed: 'album-carrier-check',
    colorway,
  });
  const seq = interiorInkSequence('album-carrier-check', 4);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(pages[i + 1]!.texts[PAGE_BACKGROUND_CARRIER_KEY], seq[i]!.bg, `第 ${i + 1} 页内页 carrier 缺失`);
  }
  assert.equal(pages[0]!.texts[PAGE_BACKGROUND_CARRIER_KEY], colorway.bg, '封面 carrier 缺失');
  assert.equal(pages[5]!.texts[PAGE_BACKGROUND_CARRIER_KEY], colorway.bg, '封尾 carrier 缺失');
});

test('assembleDesignedPages: 同一个 interiorSeed 两次成稿,内页配色逐页相同', () => {
  // 追加照片那条路会拿同一个 seed 重算一遍序列;不稳定就等于新页与老页配色错乱。
  const build = () =>
    assembleDesignedPages({
      interiorPages: [0, 1, 2, 3, 4, 5].map((i) => ({
        pageIndex: i, templateId: 'mag-08', images: {}, texts: {},
      })) as never,
      set: { coverTemplateId: 'mag-62', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
      coverTexts: {}, endingTexts: {}, fonts: FONTS, colors: COLORS,
      interiorSeed: 'album-stable',
      colorway: { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
    });
  const bgOf = (html: string) => /background-color:\s*(#[0-9a-fA-F]{6})/i.exec(html)?.[1];
  assert.deepEqual(build().map((p) => bgOf(p.html!)), build().map((p) => bgOf(p.html!)));
});

test('assembleDesignedPages: 换一本书(换 seed)内页配色跟着换', () => {
  const build = (seed: string) =>
    assembleDesignedPages({
      interiorPages: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        pageIndex: i, templateId: 'mag-08', images: {}, texts: {},
      })) as never,
      set: { coverTemplateId: 'mag-62', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
      coverTexts: {}, endingTexts: {}, fonts: FONTS, colors: COLORS,
      interiorSeed: seed,
      colorway: { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
    });
  const bgs = (seed: string) =>
    build(seed).map((p) => /background-color:\s*(#[0-9a-fA-F]{6})/i.exec(p.html!)?.[1]).join(',');
  assert.notEqual(bgs('album-aaa'), bgs('album-bbb'), 'seed 没被用上的话两本书会一模一样');
});

test('assembleDesignedPages: 没有 interiorSeed 的老书走老三色表,不混进新五色', () => {
  // interiorSeed 是本次新加的,线上已成稿的第三套老书 draft 里没有它 —— 那些书的页面
  // 早烘成了老三色,追加页必须跟着老表走。
  const pages = assembleDesignedPages({
    interiorPages: [0, 1, 2, 3].map((i) => ({
      pageIndex: i, templateId: 'mag-08', images: {}, texts: {},
    })) as never,
    set: { coverTemplateId: 'mag-62', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
    coverTexts: {}, endingTexts: {}, fonts: FONTS, colors: COLORS,
    colorway: { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
  });
  const legacy = legacyInteriorInkSequence(4);
  for (let i = 0; i < 4; i += 1)
    assert.match(pages[i + 1]!.html!, new RegExp(`background-color:\\s*${legacy[i]!.bg}`, 'i'));
  // 新五色一个都不能出现 —— 走错表时正是这个样子。
  for (const bg of ['#F3F0A8', '#9F82E8', '#C83E18', '#107E47', '#2D6DB0'])
    for (const page of pages) assert.doesNotMatch(page.html!, new RegExp(bg, 'i'));
});

test('assembleDesignedPages: 不带 colorway 时行为不变(仍走单色 pageBackground)', () => {
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }] as never,
    set: { coverTemplateId: 'mag-01', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    pageBackground: '#FBF8F1',
  });
  assert.match(pages[1]!.html!, /background-color:\s*#FBF8F1/i);
  assert.doesNotMatch(pages[1]!.html!, /#0E2A47/i);
});

// ── 封面装饰槽的颜色(评审 F4) ─────────────────────────────────────────────
// CoverColorway 的契约白纸黑字写着 sub 是「副标题 / 竖排系列名 / 底部署名」色。
// mag-62 的 label(竖排系列名)/label2(yujee 落款)/label3(年份署名)三个槽 role
// 都是 decoration —— 走通用的「decoration 跟标题色」规则的话,三个全成了主标题的
// 粉色,和批准的设计稿不是一回事。

test('assembleDesignedPages: 第三套封面的 decoration 槽走 colorway.sub,不跟主标题色', () => {
  const CREAM = { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' };
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }] as never,
    set: { coverTemplateId: 'mag-62', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
    coverTexts: { title: '书名', explain: '副标题', label: 'Yujee Collection ①', label2: 'yujee', label3: '2026 年记' },
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    colorway: CREAM,
  });
  const cover = pages[0]!.texts;
  assert.equal(cover['title#accentColor'], CREAM.title, '主标题仍是 colorway.title');
  for (const slot of ['label', 'label2', 'label3']) {
    assert.equal(cover[`${slot}#accentColor`], CREAM.sub, `${slot} 应当是 sub 色`);
    assert.notEqual(cover[`${slot}#accentColor`], CREAM.title);
  }
  assert.equal(cover['explain#accentColor'], CREAM.sub, 'explain(副标题)本来就是 sub');
  // 烘进 html 的也得是 sub —— carrier 写对了但填模板时没用上一样等于没修。
  assert.match(pages[0]!.html!, new RegExp(`color:${CREAM.sub}`, 'i'));
});

test('sweepCarriers: 不给 decoration 色时仍跟标题色(其余三套的通用规则一个字没改)', () => {
  const swept = sweepCarriers(
    [{ pageIndex: 0, templateId: 'mag-62', images: {}, texts: { title: 'T', label: 'L' } }],
    FONTS,
    COLORS, // 没有 decoration 键
  );
  assert.equal(swept[0]!.texts['label#accentColor'], COLORS.title);
  assert.equal(swept[0]!.texts['title#accentColor'], COLORS.title);
});

test('assembleDesignedPages: 深色内页的 decoration 仍跟亮字 accent(内页没有 sub 这一说)', () => {
  // mag-08 是 interior 且有一个 role=decoration 的 label 槽。
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} }] as never,
    set: { coverTemplateId: 'mag-62', coverPhotoId: 'p1', endingTemplateId: 'mag-22', endingPhotoId: 'p2' },
    coverTexts: {},
    endingTexts: {},
    fonts: FONTS,
    colors: COLORS,
    colorway: { id: 'cream', name: '奶黄', nameEn: 'Cream', bg: '#F9EDC4', title: '#1F3A2E', sub: '#4A4A42' },
  });
  const interior = pages[1]!.texts;
  // 这条没传 interiorSeed(等价老书),走老三色表。
  const ink = legacyInteriorInkSequence(1)[0]!;
  // 内页没有 sub 这一说:decoration 跟标题同色,而两个字色方案下它就等于这一页的字色。
  assert.equal(interior['label#accentColor'], ink.accent);
  assert.equal(interior['title#accentColor'], ink.accent);
  // 新书(带 seed)的内页字色只能是那两个之一 —— 两色字规则。
  const modern = interiorInkSequence('album-any', 1)[0]!;
  assert.ok(
    modern.accent === THIRD_SET_INK.light || modern.accent === THIRD_SET_INK.dark,
    '内页字色只能是那两个之一',
  );
});

test('assembleDesignedPages: 无补充照片时后续图槽复用 endingPhotoId 不留空', async () => {
  const { assembleDesignedPages, pickEndingTemplateId } = await import('./design-apply');
  const { TEMPLATES } = await import('@yujee/contracts');
  const endingId = pickEndingTemplateId('album-a')!;
  const endingSlots = ((TEMPLATES as Record<string, { images?: { id: string }[] }>)[endingId].images ?? []).map((s) => s.id);
  const pages = assembleDesignedPages({
    interiorPages: [{ pageIndex: 0, templateId: 'mag-02', images: {}, texts: {} }],
    set: { coverTemplateId: 'mag-32', coverPhotoId: 'hero-1', endingTemplateId: endingId, endingPhotoId: 'hero-2' },
    coverTexts: {},
    endingTexts: {},
    fonts: { title: 'Fraunces', body: 'Inter', decoration: 'Caveat' },
    colors: { title: '#111', body: '#222', explain: '#333' },
  });
  const ending = pages[pages.length - 1];
  for (const slotId of endingSlots) {
    assert.equal(ending.images[slotId], 'hero-2');
  }
});

test('darkInkByPageIndex: 目录页跟封面/封底同色,不参与内页随机', () => {
  // 小雨拍板 2026-08-28:封面/目录/封底三张同色,整本书洗一次。
  // ⚠️ 成稿链路目前会把目录页整页丢掉(mergeComposeIntoDraft 只重拼 [封面,内页,封尾]),
  // 所以这条钉的是「目录页一旦回到页序里就该拿 colorway」,不是线上现状。
  const colorway = { id: 'blue', name: '蓝', nameEn: 'Blue', bg: '#2D6DB0', title: '#F5F2E8', sub: '#F5F2E8' };
  const ordered = [
    { pageIndex: 0, templateId: 'mag-62', images: {}, texts: {} },
    { pageIndex: 1, templateId: 'mag-02', images: {}, texts: {} }, // toc
    { pageIndex: 2, templateId: 'mag-08', images: {}, texts: {} },
    { pageIndex: 3, templateId: 'mag-63', images: {}, texts: {} },
  ];
  const ink = darkInkByPageIndex(ordered as never, colorway, 'album-toc');
  assert.equal(ink.get(0)!.bg, colorway.bg, '封面');
  assert.equal(ink.get(1)!.bg, colorway.bg, '目录页应当跟封面同色');
  assert.equal(ink.get(3)!.bg, colorway.bg, '封底');
  // 目录页不能占掉内页随机序列的槽位:唯一那张内页拿的是序列第 1 项。
  assert.equal(ink.get(2)!.bg, interiorInkSequence('album-toc', 1)[0]!.bg);
  assert.notEqual(ink.get(2)!.bg, colorway.bg);
});
