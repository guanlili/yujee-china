import assert from 'node:assert/strict';
import test from 'node:test';
import { TEMPLATES, PAGE_BACKGROUND_CARRIER_KEY } from '@yujee/contracts';
import { Page } from '@yujee/contracts';
import { bestInkFor, contrastRatio } from '@yujee/contracts/design';
import { mergeAppendLayoutPages, mergeComposeIntoDraft } from '@/services/job/job-service';
import { reconcileDraftDesign } from './design-apply';
// 真·端到端:直接跑设计 Agent 的 apply_book_style 源码,不做等效仿制 —— 这条 bug 的
// 病根就在「Agent 只改页面 / Web 只读 draft.design」这道包边界上,仿一个假 Agent 等于
// 把要测的那条边界抹掉了。apps/web 不依赖 design-agent 包,故走相对路径 import;
// Node 的模块解析按**被导入文件**所在目录往上找,design-agent 自己的 node_modules
// 解析得到 typebox / pi-agent-core,所以跑得起来。
import { createAlbumTools } from '../../../../../packages/design-agent/src/core/album/tools.ts';
import { loadTemplateCatalog } from '../../../../../packages/design-agent/src/core/album/templates-catalog.ts';
import {
  type AlbumBookState,
  cloneAlbumBookState,
  parseAlbumBookInput,
} from '../../../../../packages/design-agent/src/core/album/book-state.ts';

/* ───────────── 换风格 → 追加照片 → 新页外观一致(最终评审 Critical 1)─────────────

   评审实测的两条坏路:
   ① 多巴胺书(draft.design.coverColorway='red')→ apply_book_style('editorial') 刷成
      纯白 #FBF8F1 → 加一张照片 → 新页被刷成 #C83E18 深红底 + 浅字,插在一本纯白书里。
   ② 浅底书 → apply_book_style('dopamine')→ 加照片 → 新页是模板默认白底,字色却走
      extractDesignFromPages 从封面反提取到 #F5F2E8,白底浅字实测 1.06:1,整页看不见。

   病根:apply_book_style 只改 pages,persistDesignChat 不碰 draft.design;而追加照片
   那条路(mergeAppendLayoutPages / mergeAppendComposeTexts)是按 draft.design 的
   coverColorway / interiorSeed / pageBackground 派色的。两边脱节。

   判据:**追加照片后的新页,外观必须和这本书当前的实际外观一致。**            */

type TemplateInfo = { id: string; category?: string; texts?: Array<{ id: string; role: string }> };
const templates = Object.values(TEMPLATES) as TemplateInfo[];
const interior = templates.find(
  (t) =>
    t.category === 'interior' &&
    (t.texts ?? []).some((s) => s.role === 'title') &&
    (t.texts ?? []).some((s) => s.role === 'body'),
)!;
const ending = templates.find((t) => t.category === 'ending')!;

const ALBUM_ID = 'album-style-append-e2e';

function chapterNode(chapterId: string) {
  return {
    chapterId,
    description: '',
    chapterContext: '',
    accentColor: null,
    artFont: null,
    photos: [
      {
        photoId: `${chapterId}-p`,
        sceneDescription: '',
        width: 800,
        height: 600,
        orientation: 'landscape' as const,
      },
    ],
  };
}

function page(pageIndex: number, templateId: string, texts: Record<string, string> = {}) {
  return { pageIndex, templateId, images: {}, texts };
}

function pagedDraft() {
  return {
    version: 'v3-story' as const,
    tree: { chapters: [chapterNode('c1'), chapterNode('c2'), chapterNode('addx-c1')] },
    pages: [page(0, interior.id), page(1, interior.id), page(2, interior.id)],
    progress: { currentChapterId: 'addx-c1', doneChapterIds: ['c1', 'c2'] },
  };
}

/** 按真成稿回调那条路成一本书(mergeComposeIntoDraft 就是回调用的那个纯函数)。 */
function composeBook(opts: { coverTemplateId: string; pageBackground: string; coverColorway?: string }) {
  return mergeComposeIntoDraft(
    pagedDraft(),
    {
      language: 'zh',
      coverTemplateId: opts.coverTemplateId,
      coverPhotoId: 'c1-p',
      endingTemplateId: ending.id,
      endingPhotoId: 'c2-p',
      extraEndingPhotoIds: [],
      pageBackground: opts.pageBackground,
      ...(opts.coverColorway ? { coverColorway: opts.coverColorway, interiorSeed: ALBUM_ID } : {}),
    },
    {},
  ).draftJson;
}

/** 把这本书装进设计 Agent,跑真的 apply_book_style,交回 Agent 侧的页数组。 */
async function runApplyBookStyle(draftJson: { tree: unknown; pages: unknown }, styleId: string) {
  const catalog = loadTemplateCatalog();
  let book: AlbumBookState = parseAlbumBookInput({
    chapters: (draftJson.tree as { chapters: unknown[] }).chapters,
    pages: draftJson.pages,
  }).book;
  const tools = new Map(
    createAlbumTools({
      catalog,
      getBookState: () => cloneAlbumBookState(book),
      setBookState: (next) => {
        book = cloneAlbumBookState(next);
      },
    }).map((t) => [t.name, t]),
  );
  const tool = tools.get('apply_book_style')!;
  await tool.execute('e2e', tool.prepareArguments({ styleId }) as never);
  return book.pages;
}

/** persistDesignChat(committed=true)的落库口径:数组序重编号 + envelope 三件套重写。 */
function persistLikeDesignChat(
  draftJson: Record<string, unknown>,
  agentPages: unknown[],
): Record<string, unknown> {
  const pages = agentPages.map((p, i) => ({ ...Page.parse(p), pageIndex: i }));
  return {
    ...draftJson,
    pages,
    design: reconcileDraftDesign(
      draftJson.design as Parameters<typeof reconcileDraftDesign>[0],
      pages,
    ),
  };
}

/** 页根 [data-template] 开标签上的某条 style 声明(不能 includes('color:'),会被 background-color 喂饱)。 */
function rootDecl(html: string, prop: string): string | undefined {
  const openTag = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html)?.[0] ?? '';
  const style = /style="([^"]*)"/.exec(openTag)?.[1] ?? '';
  for (const d of style.split(';')) {
    const at = d.indexOf(':');
    if (at >= 0 && d.slice(0, at).trim().toLowerCase() === prop) return d.slice(at + 1).trim();
  }
  return undefined;
}

/** 一页的实际观感:页根底色 + 页根字色 + carrier。判据比对的就是这三样。 */
function lookOf(p: { html?: string; texts: Record<string, string> }) {
  return {
    bg: rootDecl(p.html ?? '', 'background-color'),
    ink: rootDecl(p.html ?? '', 'color'),
    carrier: p.texts[PAGE_BACKGROUND_CARRIER_KEY],
  };
}

async function styleThenAppend(
  book: Record<string, unknown>,
  styleId: string,
): Promise<{ pages: Array<{ html?: string; texts: Record<string, string>; templateId: string }>; design: unknown }> {
  const styled = persistLikeDesignChat(book, await runApplyBookStyle(book as never, styleId));
  const merged = mergeAppendLayoutPages(
    styled,
    [page(0, interior.id, { marker: 'new' })],
    ['addx-c1'],
  );
  return { pages: merged.pages as never, design: (merged as { design?: unknown }).design };
}

// ───────── 方向 ①:多巴胺 → 素白散文,新页不许还是深红 ─────────

test('多巴胺书换成素白散文后追加照片:新页与全书同一个纯白底,不是旧风格的深红', async () => {
  const book = composeBook({
    coverTemplateId: 'mag-62',
    pageBackground: '#F1F2F0',
    coverColorway: 'red',
  });
  assert.equal((book.design as { coverColorway?: string }).coverColorway, 'red', 'fixture 前提:这是一本深红多巴胺书');

  const { pages } = await styleThenAppend(book, 'editorial');
  const fresh = pages.find((p) => p.texts.marker === 'new')!;
  const look = lookOf(fresh);

  assert.equal(look.bg, '#FBF8F1', `新页底色应是素白散文的暖白,实际 ${look.bg}`);
  assert.equal(look.carrier, '#FBF8F1', 'carrier 也要跟上(重烘后还得认得出)');
  assert.notEqual(look.bg, '#C83E18', '新页绝不能落回旧风格的深红');
  // 全书逐页同色 —— 判据:新页外观与这本书当前的实际外观一致。
  for (const [i, p] of pages.entries()) {
    assert.equal(lookOf(p).bg, '#FBF8F1', `第 ${i} 页（${p.templateId}）底色跟全书对不上`);
  }
  const ratio = contrastRatio(look.bg!, look.ink!);
  assert.ok(ratio >= 4.5, `新页页根字色只有 ${ratio.toFixed(2)}:1`);
});

// ───────── 方向 ②:浅底 → 多巴胺,新页不许是白底浅字 ─────────

test('素白书换成多巴胺后追加照片:新页拿到本书那套多巴胺色,不是白底浅字', async () => {
  const book = composeBook({ coverTemplateId: 'mag-01', pageBackground: '#FBF8F1' });
  assert.equal((book.design as { coverColorway?: string }).coverColorway, undefined, 'fixture 前提:这是一本浅底书');

  const { pages } = await styleThenAppend(book, 'dopamine');
  const fresh = pages.find((p) => p.texts.marker === 'new')!;
  const look = lookOf(fresh);

  const DOPAMINE_BGS = ['#F3F0A8', '#9F82E8', '#C83E18', '#107E47', '#2D6DB0'];
  assert.ok(look.bg && DOPAMINE_BGS.includes(look.bg.toUpperCase()), `新页底色 ${look.bg} 不在多巴胺五色里`);
  assert.equal(look.carrier?.toUpperCase(), look.bg?.toUpperCase(), 'carrier 与页根底色必须一致');
  assert.notEqual(look.bg?.toUpperCase(), '#FFFFFF', '新页不能留成模板默认白');
  // 评审量到 1.06:1 的那条:白底 + 反提取来的浅字。
  const ratio = contrastRatio(look.bg!, look.ink!);
  assert.ok(ratio >= 4.5, `新页底色 ${look.bg} 配页根字色 ${look.ink} 只有 ${ratio.toFixed(2)}:1`);
  assert.equal(look.ink, bestInkFor(look.bg!), '深底浅字/浅底深字这条两色规则要成立');
  // 文字槽的 carrier 也得是这一格的色,不能是从封面反提取的。
  const titleSlot = (interior.texts ?? []).find((s) => s.role === 'title')!;
  assert.equal(fresh.texts[`${titleSlot.id}#accentColor`], bestInkFor(look.bg!));
  // 老页一个字节不动:序列前缀稳定。
  const interiors = pages.filter((p) => TEMPLATES[p.templateId as keyof typeof TEMPLATES]?.category === 'interior');
  for (const p of interiors) {
    const l = lookOf(p);
    assert.ok(l.bg && DOPAMINE_BGS.includes(l.bg.toUpperCase()), `内页 ${p.templateId} 底色 ${l.bg} 掉出五色`);
    assert.ok(contrastRatio(l.bg!, l.ink!) >= 4.5, `内页 ${l.bg} 配 ${l.ink} 读不了`);
  }
});

// ───────── 不能误伤:没换过风格的书,design 必须逐字节不动 ─────────

test('成稿后没换过风格的多巴胺书:reconcile 不许改写 design(改了会把老页的色序换掉)', () => {
  const book = composeBook({
    coverTemplateId: 'mag-62',
    pageBackground: '#F1F2F0',
    coverColorway: 'blue',
  });
  const pages = (book.pages as unknown[]).map((p, i) => ({ ...Page.parse(p), pageIndex: i }));
  const before = book.design as Record<string, unknown>;
  const after = reconcileDraftDesign(before as never, pages);
  assert.equal(after, before, '现状仍成立时必须原样返回同一个对象,不能重算种子');
});

test('成稿后没换过风格的单色书:同样原样返回', () => {
  const book = composeBook({ coverTemplateId: 'mag-01', pageBackground: '#FBF8F1' });
  const pages = (book.pages as unknown[]).map((p, i) => ({ ...Page.parse(p), pageIndex: i }));
  const before = book.design as Record<string, unknown>;
  assert.equal(reconcileDraftDesign(before as never, pages), before);
});

test('页面完全没有底色 carrier(纯白老书)时不猜,design 原样返回', () => {
  const design = { fonts: { title: 'a', body: 'b', decoration: 'c' }, colors: { title: '#111', body: '#222', explain: '#333' } };
  const pages = [
    { pageIndex: 0, templateId: 'mag-01', images: {}, texts: {} },
    { pageIndex: 1, templateId: interior.id, images: {}, texts: {} },
  ];
  assert.equal(reconcileDraftDesign(design as never, pages as never), design);
});

test('design 缺省(从没设计过)时不无中生有', () => {
  assert.equal(reconcileDraftDesign(undefined, []), undefined);
});

// ───────── 边界:全书被刷成**深**底色之后再追加照片 ─────────
// 这条是 Critical 1 的修法自己开出来的口子:修之前 draft.design.pageBackground 只可能
// 是 PAGE_BACKGROUNDS 那四个白,追加路径的 applyPageBackground 只写 background-color、
// 不写页根 color 也没事(白底配模板默认的近黑字);对账之后它能落到任何一个**实际**底色,
// 包括多巴胺那三个深色 —— 那时只写底色不写字色,新页就是深底压近黑字,整页读不了。

test('全书刷成多巴胺蓝底后追加照片:新页不能是蓝底压近黑字', async () => {
  const book = composeBook({ coverTemplateId: 'mag-01', pageBackground: '#FBF8F1' });
  // 先换到多巴胺(set_page_background 的调色板按当前风格取,靠封面模板反推),
  // 再把全书刷成同一个蓝底 —— 两步都是真工具。
  const catalog = loadTemplateCatalog();
  let state: AlbumBookState = parseAlbumBookInput({
    chapters: book.tree.chapters,
    pages: book.pages,
  }).book;
  const tools = new Map(
    createAlbumTools({
      catalog,
      getBookState: () => cloneAlbumBookState(state),
      setBookState: (next) => {
        state = cloneAlbumBookState(next);
      },
    }).map((t) => [t.name, t]),
  );
  const styleTool = tools.get('apply_book_style')!;
  await styleTool.execute('s', styleTool.prepareArguments({ styleId: 'dopamine' }) as never);
  const bgTool = tools.get('set_page_background')!;
  await bgTool.execute('b', bgTool.prepareArguments({ pages: 'all', colorId: 'blue' }) as never);

  const styled = persistLikeDesignChat(book, state.pages);
  assert.equal(
    (styled.design as { pageBackground?: string }).pageBackground,
    '#2D6DB0',
    '全书单色时 design.pageBackground 应对账成这个深蓝',
  );
  const merged = mergeAppendLayoutPages(
    styled,
    [page(0, interior.id, { marker: 'new' })],
    ['addx-c1'],
  );
  const fresh = (merged.pages as Array<{ html?: string; texts: Record<string, string> }>).find(
    (p) => p.texts.marker === 'new',
  )!;
  const look = lookOf(fresh);
  assert.equal(look.bg, '#2D6DB0', '新页要跟全书同底');
  const ratio = contrastRatio(look.bg!, look.ink!);
  assert.ok(ratio >= 4.5, `新页 ${look.bg} 配页根字色 ${look.ink} 只有 ${ratio.toFixed(2)}:1,整页读不了`);
  assert.equal(look.ink, bestInkFor(look.bg!));
});
