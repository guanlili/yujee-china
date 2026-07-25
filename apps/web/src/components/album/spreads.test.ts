import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import {
  buildSpreads,
  isSoloSpread,
  shouldDirectSwitch,
  spreadFullPage,
  spreadIndexOfPage,
  spreadPageIndices,
  spreadRenderKind,
} from './spreads';
import type { EditorPage } from './types';

// Real template ids carry the category we group by. Cover ids are derived from the
// registry, not hardcoded — templates get re-categorized (the dev template bench
// writes `category` straight into the template JSON), and a hardcoded "this id is
// a cover" would silently rot into a false premise.
const COVER_IDS = TEMPLATE_IDS.filter((id) => TEMPLATES[id]?.category === 'cover');
const [COVER_A, COVER_B] = COVER_IDS;

test('fixture premise: at least two cover templates exist', () => {
  assert.ok(COVER_A && COVER_B, `需要至少两个封面模板，当前只有：${COVER_IDS.join(', ') || '(无)'}`);
});

function page(templateId: string, pageIndex: number): EditorPage {
  return { pageIndex, templateId, imagesJson: {}, textsJson: {} };
}

test('cover opens recto, interior pages pair in between', () => {
  const pages = [
    page(COVER_A!, 0), // cover
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-06', 3), // interior
    page('mag-19', 4), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 }, // cover solo (recto)
    { kind: 'pair', left: 1, right: 2 }, // interior pair
    { kind: 'pair', left: 3, right: 4 }, // interior pair
  ]);
});

test('cover + one interior leaves the interior with a blank facing half', () => {
  const pages = [page(COVER_A!, 0), page('mag-03', 1)];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 },
    { kind: 'pair', left: 1, right: null },
  ]);
});

test('interior-only pairs two-up, odd gets a blank half', () => {
  assert.deepEqual(
    buildSpreads([page('mag-03', 0), page('mag-05', 1)]),
    [{ kind: 'pair', left: 0, right: 1 }],
  );
  assert.deepEqual(
    buildSpreads([page('mag-03', 0), page('mag-05', 1), page('mag-06', 2)]),
    [{ kind: 'pair', left: 0, right: 1 }, { kind: 'pair', left: 2, right: null }],
  );
});

test('spreadIndexOfPage finds the spread holding a page index', () => {
  const spreads = buildSpreads([
    page(COVER_A!, 0),
    page('mag-03', 1),
    page('mag-05', 2),
  ]);
  assert.equal(spreadIndexOfPage(spreads, 0), 0); // cover
  assert.equal(spreadIndexOfPage(spreads, 1), 1); // interior pair
  assert.equal(spreadIndexOfPage(spreads, 2), 1);
  assert.equal(spreadIndexOfPage(spreads, 99), -1);
});

// ── issue #158 parity regression: cover/ending are solo half-pages, so any
// extra cover or a mid-document ending shifts the parity of every
// following interior pair. The old flat ceil/floor pagination got this wrong.

test('ending closes verso; full cover→interior→ending lays out solo + paired', () => {
  const pages = [
    page(COVER_A!, 0), // cover (solo recto)
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-06', 3), // interior
    page('mag-20', 4), // ending (solo verso)
  ];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 }, // cover solo
    { kind: 'pair', left: 1, right: 2 }, // interior pair
    { kind: 'pair', left: 3, right: null }, // odd interior flushed before ending → blank half
    { kind: 'pair', left: 4, right: null }, // ending solo (verso)
  ]);
});

test('a second cover mid-document re-aligns following interior parity', () => {
  const pages = [
    page(COVER_A!, 0), // cover
    page('mag-03', 1), // interior
    page(COVER_B!, 2), // second cover (mid-document) — forces a solo spread
    page('mag-05', 3), // interior
    page('mag-06', 4), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 }, // cover solo
    { kind: 'pair', left: 1, right: null }, // lone interior flushed before the second cover
    { kind: 'pair', left: null, right: 2 }, // second cover solo recto
    { kind: 'pair', left: 3, right: 4 }, // interior pair, parity re-based after the cover
  ]);
  // spreadIndexOfPage must follow the shifted parity, not a flat /2.
  assert.equal(spreadIndexOfPage(buildSpreads(pages), 3), 3);
  assert.equal(spreadIndexOfPage(buildSpreads(pages), 4), 3);
});

test('an ending mid-document forces the next interior onto a fresh pair', () => {
  const pages = [
    page(COVER_A!, 0), // cover
    page('mag-03', 1), // interior
    page('mag-20', 2), // ending mid-document — solo verso
    page('mag-05', 3), // interior after the ending
    page('mag-06', 4), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 }, // cover solo
    { kind: 'pair', left: 1, right: null }, // lone interior flushed before the ending
    { kind: 'pair', left: 2, right: null }, // ending solo verso
    { kind: 'pair', left: 3, right: 4 }, // fresh interior pair after the ending
  ]);
});

// ── WP4.2 / §4.4 skip cases: V3 makes the book-design step optional, so the
// "page 0 must be cover" rule is gone (§4.1). The canvas must lay the book out
// without injecting a blank solo spread or crashing when the cover, the ending,
// or both are skipped. Interior-only pages just pair two-up from the first page.

test('skip cover: an album with no cover starts straight into a paired interior spread', () => {
  const pages = [
    page('mag-03', 0), // interior (no cover ahead of it — book opens here)
    page('mag-05', 1), // interior
    page('mag-06', 2), // interior
    page('mag-20', 3), // ending (solo verso)
  ];
  // No leading { kind: 'pair', left: null, right: 0 } cover spread is fabricated — the first
  // interior pair is the first spread. The ending still closes solo.
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: 0, right: 1 }, // interior pair (book opens here, no blank cover page)
    { kind: 'pair', left: 2, right: null }, // odd interior flushed before the ending
    { kind: 'pair', left: 3, right: null }, // ending solo verso
  ]);
});

test('skip ending: an album with a cover but no ending closes on a paired interior spread', () => {
  const pages = [
    page(COVER_A!, 0), // cover (solo recto)
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
  ];
  // No trailing { kind: 'pair', left: i, right: null } ending spread is fabricated — the book
  // just ends on the last interior pair (which here is complete, no blank half).
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 }, // cover solo recto
    { kind: 'pair', left: 1, right: 2 }, // interior pair closes the book
  ]);
});

test('skip both: an interior-only album never gets a fabricated blank solo spread', () => {
  const pages = [
    page('mag-03', 0),
    page('mag-05', 1),
    page('mag-06', 2),
    page('mag-19', 3),
  ];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: 0, right: 1 },
    { kind: 'pair', left: 2, right: 3 },
  ]);
});

test('empty book: zero pages yields zero spreads (no crash, no blank page)', () => {
  // The draft/cover step can legitimately leave the book empty (skip everything).
  // buildSpreads must return []; EditorBook.spreadCount() clamps this to a single
  // visible (empty) spread, so the canvas never indexes into a missing spread.
  assert.deepEqual(buildSpreads([]), []);
});

// ── solo-page classification (FlipBook single-page render). A cover/ending sits
// on its own spread and must render as ONE centered page (no blank facing half,
// no spine). The trap: an interior odd-trailing page has the IDENTICAL shape
// ({ kind: 'pair', left: i, right: null }) but its blank half is normal spread whitespace and
// must stay — so isSoloSpread keys off the occupied page's category, never off
// "a half is null".

test('isSoloSpread: cover-solo (left null, right=cover) is solo', () => {
  const pages = [page(COVER_A!, 0), page('mag-03', 1), page('mag-05', 2)];
  const spreads = buildSpreads(pages);
  // [{ kind: 'pair', left: null, right: 0 }, { kind: 'pair', left: 1, right: 2 }]
  assert.equal(isSoloSpread(spreads[0], pages), true);
});

test('isSoloSpread: ending-solo (left=ending, right null) is solo', () => {
  const pages = [
    page(COVER_A!, 0), // cover
    page('mag-03', 1), // interior
    page('mag-05', 2), // interior
    page('mag-20', 3), // ending (solo verso)
  ];
  const spreads = buildSpreads(pages);
  const endingSpread = spreads.find((s) => s.kind === 'pair' && s.left === 3);
  assert.ok(endingSpread, 'expected an ending spread holding page 3');
  assert.equal(isSoloSpread(endingSpread, pages), true);
});

test('isSoloSpread: interior odd-trailing { left:i, right:null } is NOT solo (keeps blank half)', () => {
  // Three interior pages → one full pair + one odd trailing interior with a blank
  // facing half. That blank half is normal whitespace, NOT a solo page.
  const pages = [page('mag-03', 0), page('mag-05', 1), page('mag-06', 2)];
  const spreads = buildSpreads(pages);
  // [{ kind: 'pair', left: 0, right: 1 }, { kind: 'pair', left: 2, right: null }]
  assert.deepEqual(spreads[1], { kind: 'pair', left: 2, right: null });
  assert.equal(
    isSoloSpread(spreads[1], pages),
    false,
    'interior odd-trailing must stay a double-width spread with a blank half',
  );
});

test('isSoloSpread: a paired interior spread is never solo', () => {
  const pages = [page('mag-03', 0), page('mag-05', 1)];
  const spreads = buildSpreads(pages); // [{ kind: 'pair', left: 0, right: 1 }]
  assert.equal(isSoloSpread(spreads[0], pages), false);
});

test('isSoloSpread: undefined / out-of-range spread is not solo (no crash)', () => {
  const pages = [page(COVER_A!, 0)];
  assert.equal(isSoloSpread(undefined, pages), false);
  assert.equal(isSoloSpread({ kind: 'pair', left: 99, right: null }, pages), false);
});

// ── #303 双宽跨页(spread:true)。一个双宽模板 = 一张 1588×1123 的画布,独占一整个
// 物理跨页,所以它是 { kind: 'full', page } —— 一整张面,不是左右两半。
//
// 这里用判别式联合而不是可选的 `full?` 字段,正是因为可选字段让「忘记处理双宽」
// 不产生编译错误:翻书 / 画板总览 / 拼图 / Live 视频 / 焦点页五个消费者都曾静默把
// 双宽页降级成一个空白跨页。改成联合后,不先窄化 kind 就读 .left 是类型错误。

test('a spread template owns a whole physical spread (kind: full)', () => {
  const pages = [
    page(COVER_A!, 0), // cover — solo recto
    page('mag-03', 1), // interior
    page('mag-54', 2), // 双宽 — 独占一整个跨页
    page('mag-05', 3), // interior
  ];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: null, right: 0 }, // cover solo recto
    // 双宽页来之前那个落单的内页要先把当前跨页收掉(右半留空),否则双宽页会被
    // 当成右半塞进去,整本从这里开始错位。
    { kind: 'pair', left: 1, right: null },
    { kind: 'full', page: 2 }, // 双宽页独占
    { kind: 'pair', left: 3, right: null }, // 双宽页之后从新跨页的左半重新起排
  ]);
});

test('two adjacent interiors before a spread still pair normally', () => {
  const pages = [page('mag-03', 0), page('mag-05', 1), page('mag-54', 2)];
  assert.deepEqual(buildSpreads(pages), [
    { kind: 'pair', left: 0, right: 1 },
    { kind: 'full', page: 2 },
  ]);
});

test('spreadIndexOfPage finds a full (double-wide) spread by its page index', () => {
  const pages = [page(COVER_A!, 0), page('mag-03', 1), page('mag-54', 2), page('mag-05', 3)];
  const spreads = buildSpreads(pages);
  assert.equal(spreadIndexOfPage(spreads, 2), 2, '双宽页必须能被它的页下标找到');
  assert.equal(spreadIndexOfPage(spreads, 3), 3);
  assert.equal(spreadIndexOfPage(spreads, 99), -1);
});

test('isSoloSpread: a full (double-wide) spread is NOT solo — it keeps the full width', () => {
  const pages = [page('mag-54', 0)];
  const spreads = buildSpreads(pages);
  assert.deepEqual(spreads, [{ kind: 'full', page: 0 }]);
  // solo = 「单页 leaf」(封面/封尾,容器收窄成单页宽)。双宽页刚好相反:它要占满
  // 双页宽。若这里回 true,翻书会把它塞进半页宽的容器里。
  assert.equal(isSoloSpread(spreads[0], pages), false);
});

test('spreadFullPage / spreadPageIndices expose a full spread as ONE face, not two halves', () => {
  const pages = [page('mag-03', 0), page('mag-54', 1)];
  const [pair, full] = buildSpreads(pages);
  assert.equal(spreadFullPage(full), 1);
  assert.equal(spreadFullPage(pair), null, '普通跨页不是双宽页');
  assert.equal(spreadFullPage(undefined), null);
  // 「这个跨页上有哪些页」—— 双宽页只有一页(它自己),不是两个 null。
  // I5 回归:authoringFocusPageIndex 取的就是这个列表的第一项;若它是空,AI 改稿会
  // 回落到 pageIndex 0(封面)—— 写错页。
  assert.deepEqual(spreadPageIndices(full), [1]);
  assert.deepEqual(spreadPageIndices(pair), [0]);
  assert.deepEqual(spreadPageIndices(undefined), []);
});

test('no-spread regression: an album with no spread template is all kind:pair', () => {
  const pages = [page(COVER_A!, 0), page('mag-03', 1), page('mag-05', 2), page('mag-20', 3)];
  const spreads = buildSpreads(pages);
  assert.ok(
    spreads.every((s) => s.kind === 'pair'),
    '不含双宽模板的相册必须逐个跨页与改造前完全一致(全部 pair)',
  );
  assert.deepEqual(spreads, [
    { kind: 'pair', left: null, right: 0 },
    { kind: 'pair', left: 1, right: 2 },
    { kind: 'pair', left: 3, right: null },
  ]);
});

// ── spreadRenderKind:翻书 / 画板 / 拼图 / Live 视频四个画面共用的三选一分类。
// 双宽页最容易被误判成 'solo'(两者都「只有一页」),但它们的容器宽度恰好相反:
// solo 收窄成单页宽,full 撑满双页宽。

test('spreadRenderKind: full > solo > pair, and a full spread is never solo', () => {
  const pages = [
    page(COVER_A!, 0), // cover → solo
    page('mag-03', 1), // 落单内页 → pair(空白半页是正常留白)
    page('mag-54', 2), // 双宽 → full
    page('mag-05', 3),
    page('mag-06', 4),
    page('mag-20', 5), // ending → solo
  ];
  const spreads = buildSpreads(pages);
  assert.deepEqual(
    spreads.map((s) => spreadRenderKind(s, pages)),
    ['solo', 'pair', 'full', 'pair', 'solo'],
  );
});

test('spreadRenderKind: a missing spread degrades to pair (no crash)', () => {
  assert.equal(spreadRenderKind(undefined, []), 'pair');
});

// ── shouldDirectSwitch(goToSpread's direct-switch guard, review finding #303).
// A real behavioral predicate, not a source-text regex — actual boolean inputs
// drive it, so an operator-precedence slip (`&&` sneaking into an `||` chain)
// cannot hide the way it could behind a substring-containment check. The plain
// pair→pair case (all five reasons false) is the must-animate control: if any
// implementation accidentally ORs in an extra always-true term, this is what
// catches it.

test('shouldDirectSwitch: plain pair→pair (no reason present) must still animate', () => {
  assert.equal(shouldDirectSwitch(false, false, false, false, false), false);
});

test('shouldDirectSwitch: reduced motion alone forces a direct switch', () => {
  assert.equal(shouldDirectSwitch(true, false, false, false, false), true);
});

test('shouldDirectSwitch: solo source alone forces a direct switch', () => {
  // This is the exact case an `&&`-joined solo pair (`soloSource && soloTarget`)
  // gets wrong: source is a solo cover/ending, target is a plain paired spread —
  // soloTarget is false, so `soloSource && soloTarget` is false and the buggy
  // form would fall through to the leaf-flip animation (a half-width leaf flown
  // across a width change — tear/blank flash). The real OR must catch it.
  assert.equal(shouldDirectSwitch(false, true, false, false, false), true);
});

test('shouldDirectSwitch: solo target alone forces a direct switch', () => {
  // Mirror of the above: target is solo, source is a plain paired spread.
  assert.equal(shouldDirectSwitch(false, false, true, false, false), true);
});

test('shouldDirectSwitch: full (double-wide) source alone forces a direct switch', () => {
  assert.equal(shouldDirectSwitch(false, false, false, true, false), true);
});

test('shouldDirectSwitch: full (double-wide) target alone forces a direct switch', () => {
  assert.equal(shouldDirectSwitch(false, false, false, false, true), true);
});

test('shouldDirectSwitch: multiple reasons at once still direct-switches', () => {
  assert.equal(shouldDirectSwitch(true, true, false, true, false), true);
});
