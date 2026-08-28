import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THIRD_SET_COVERS,
  LEGACY_THIRD_SET_COVERS,
  coverColorwayForAlbum,
  THIRD_SET_INTERIOR,
  THIRD_SET_INK,
  LEGACY_THIRD_SET_INTERIOR,
  interiorInkSequence,
  legacyInteriorInkSequence,
  coverColorwayById,
  THIRD_SET_COVER_TEMPLATE_ID,
} from './third-set-palette';

const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('封面 3 个配色(黄/蓝/红),深青和粉都不再派给新书', () => {
  // 2026-08-28 小雨拍板:封面/目录/封底三张同色,整本书洗一次,只用黄蓝红。
  assert.deepEqual(THIRD_SET_COVERS.map((c) => c.bg), ['#F3F0A8', '#2D6DB0', '#C83E18']);
  assert.equal(THIRD_SET_COVER_TEMPLATE_ID, 'mag-62');
  for (const gone of ['#12363A', '#F0A4C2', '#0E2A47', '#F9EDC4'])
    assert.ok(!THIRD_SET_COVERS.some((c) => c.bg === gone), `${gone} 不该再派给新书`);
});

test('封面也是两色字:每个配色的 title/sub 同色,与内页同一套口径', () => {
  for (const c of THIRD_SET_COVERS) {
    assert.equal(c.title, c.sub, `${c.id} 封面标题色与副标色必须同一个`);
    assert.ok(
      c.title === THIRD_SET_INK.light || c.title === THIRD_SET_INK.dark,
      `${c.id} 封面字色只能是那两个之一`,
    );
  }
});

test('老配色 id 仍然查得到 —— 否则线上老书的深色路径会静默关掉', () => {
  // 老书的 draft.design.coverColorway 里存着 teal/cream/pink/navy。查不到 → colorway
  // 为 undefined → assembleDesignedPages 整条深色分支不走 → 老书追加页刷成白底浅字。
  assert.deepEqual(LEGACY_THIRD_SET_COVERS.map((c) => c.id), ['teal', 'cream', 'pink', 'navy']);
  assert.equal(coverColorwayById('teal')?.bg, '#12363A');
  assert.equal(coverColorwayById('teal')?.title, '#F0A4C2');
  assert.equal(coverColorwayById('navy')?.bg, '#0E2A47');
  assert.equal(coverColorwayById('cream')?.bg, '#F9EDC4');
  assert.equal(coverColorwayById('pink')?.bg, '#F0A4C2');
  // 老表也得过对比度(它们本来就过,这条防的是「顺手改了老值」)。
  for (const c of LEGACY_THIRD_SET_COVERS) {
    assert.ok(contrast(c.title, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
    assert.ok(contrast(c.sub, c.bg) >= 4.5, `${c.id} 副标对比度不足`);
  }
});

test('coverColorwayForAlbum: 只从新三色里派,永远不会派到老色', () => {
  const fresh = new Set(THIRD_SET_COVERS.map((c) => c.id));
  const hit = new Map<string, number>();
  const N = 3000;
  for (let i = 0; i < N; i += 1) {
    const picked = coverColorwayForAlbum(`a1b2c3d4-0000-4000-8000-${String(i).padStart(12, '0')}`);
    assert.ok(fresh.has(picked.id), `派到了非新色 ${picked.id}`);
    hit.set(picked.id, (hit.get(picked.id) ?? 0) + 1);
  }
  // 三档要均分 —— 内页那次就是取模只读到低位、几个色永不出现。
  assert.equal(hit.size, THIRD_SET_COVERS.length, `只派出了 ${hit.size} 个色`);
  for (const [id, n] of hit) {
    const pct = (n / N) * 100;
    assert.ok(pct > 26 && pct < 41, `${id} 占 ${pct.toFixed(1)}%(理论 33.3%),分布偏斜`);
  }
});

test('封面每个配色的标题对比度 >= 4.5:1(大字号也不将就)', () => {
  for (const c of THIRD_SET_COVERS) {
    assert.ok(contrast(c.title, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
    assert.ok(contrast(c.sub, c.bg) >= 4.5, `${c.id} 副标对比度不足`);
  }
});

test('内页 5 个彩色底,深浅混合,每个都对比度达标', () => {
  assert.equal(THIRD_SET_INTERIOR.length, 5);
  for (const c of THIRD_SET_INTERIOR) {
    assert.ok(contrast(c.body, c.bg) >= 4.5, `${c.id} 正文对比度不足`);
    assert.ok(contrast(c.accent, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
  }
  // 深浅都要有 —— 全深或全浅就不是「随机混合」了。
  const dark = THIRD_SET_INTERIOR.filter((c) => c.body === THIRD_SET_INK.light);
  const light = THIRD_SET_INTERIOR.filter((c) => c.body === THIRD_SET_INK.dark);
  assert.ok(dark.length >= 2, '深底至少两个');
  assert.ok(light.length >= 2, '浅底至少两个');
  assert.equal(dark.length + light.length, THIRD_SET_INTERIOR.length);
});

test('全书只有两个字色:深底一律浅字,浅底一律深字', () => {
  // 用户拍板的规则(2026-08-28)。派生字色那版被否掉了 —— 五个底色各配各的字色,
  // 印出来像五本不同的书。这条断言就是那个决定,别再改回按底色逐个派。
  const inks = new Set(THIRD_SET_INTERIOR.flatMap((c) => [c.accent, c.body]));
  assert.deepEqual([...inks].sort(), [THIRD_SET_INK.dark, THIRD_SET_INK.light].sort());
  for (const c of THIRD_SET_INTERIOR) {
    assert.equal(c.accent, c.body, `${c.id} 标题色和正文色必须同一个`);
  }
});

test('interiorInkSequence: 同 seed 同长度,两次调用逐项相同', () => {
  // 这是整条路的地基:成书主路和追加照片那条路各自调一次,结果必须逐字节一样,
  // 否则加几张照片就会把新页刷成跟老页不同的一套色(老页的色早烘死在 html 里)。
  const a = interiorInkSequence('album-abc', 12);
  const b = interiorInkSequence('album-abc', 12);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
});

test('interiorInkSequence: 前缀稳定 —— 追加页不会改动已有页的颜色', () => {
  // 追加照片时长度会变长(10 → 13),前 10 项必须原封不动。
  const short = interiorInkSequence('album-abc', 10);
  const long = interiorInkSequence('album-abc', 13);
  assert.deepEqual(long.slice(0, 10).map((x) => x.id), short.map((x) => x.id));
});

test('interiorInkSequence: 不同 seed 给出不同序列(seed 真的被用上了)', () => {
  const a = interiorInkSequence('album-aaa', 20).map((x) => x.id).join(',');
  const b = interiorInkSequence('album-bbb', 20).map((x) => x.id).join(',');
  assert.notEqual(a, b, '换本书应当换一套排列,否则 seed 形同虚设');
});

test('interiorInkSequence: 纯随机有放回 —— 相邻同色会发生,占比约五分之一', () => {
  // 小雨拍板 2026-08-28:去掉「相邻不撞色」那条约束,每页从五色里独立抽。
  // 这条断言的是它**确实会**撞 —— 把约束加回来(pool 排掉上一页)这条就红。
  let adjacentSame = 0;
  let pairs = 0;
  for (let i = 0; i < 400; i += 1) {
    const seq = interiorInkSequence(`album-${i}`, 30).map((x) => x.id);
    for (let j = 1; j < seq.length; j += 1) {
      pairs += 1;
      if (seq[j] === seq[j - 1]) adjacentSame += 1;
    }
  }
  const pct = (adjacentSame / pairs) * 100;
  assert.ok(pct > 15 && pct < 26, `相邻同色占 ${pct.toFixed(1)}%(五取一理论值 20%)`);
});

test('interiorInkSequence: 五个色都用得上,不会退化成两色来回跳', () => {
  const ids = new Set(interiorInkSequence('album-xyz', 60).map((x) => x.id));
  assert.equal(ids.size, THIRD_SET_INTERIOR.length, '长书里五个底色应当都出现过');
});

// ── 多样性守卫(2026-08-28 评审 H1 的事故现场)────────────────────────────
// 第一版用 `hash32(seed#i) % pool.length` 直接取模。FNV-1a 的低位是个 4 状态自动机
// (乘数 0x01000193 ≡ 3 mod 4),而排掉上一页后 pool.length 恒为 4 —— 取模只读到低 2 位。
// 实测 2 万本真书:整条序列只有 20 种,第 3 页起只有 4 种,随机两本书 24.8% 概率从第 3 页
// 起一模一样,100% 的书里有 >=8 页的四色循环,第 3 页永远不会是紫或绿。
// 上面那几条(确定性/前缀稳定/相邻不撞色/五色都用上)全绿,一条都没拦住。
// 下面三条是补上的守卫,把雪崩那一步拿掉就会红。

test('interiorInkSequence: 不同书之间真的分得开(挡住低位哈希退化)', () => {
  const seeds = Array.from({ length: 500 }, (_, i) => `album-${i}`);
  const tails = new Set(
    seeds.map((s) => interiorInkSequence(s, 40).slice(2).map((x) => x.id).join(',')),
  );
  assert.ok(tails.size >= 480, `500 本书的「第 3 页起」只有 ${tails.size} 种排列,哈希退化了`);
});

test('interiorInkSequence: 每个页位上五色分布不偏(挡住某几个色永不出现)', () => {
  // 理论值:第 0 位五取一 = 20%;其后排掉上一页,四取一 × 上一页不是它(4/5)= 仍是 20%。
  const seeds = Array.from({ length: 2000 }, (_, i) => `album-${i}`);
  for (const pos of [0, 2, 7, 15]) {
    const count = new Map<string, number>();
    for (const seed of seeds) {
      const id = interiorInkSequence(seed, 20)[pos]!.id;
      count.set(id, (count.get(id) ?? 0) + 1);
    }
    assert.equal(count.size, THIRD_SET_INTERIOR.length, `第 ${pos} 位只出现了 ${count.size} 个色`);
    for (const [id, n] of count) {
      const pct = (n / seeds.length) * 100;
      assert.ok(pct > 14 && pct < 27, `第 ${pos} 位 ${id} 占 ${pct.toFixed(1)}%(理论 20%),分布偏斜`);
    }
  }
});

test('interiorInkSequence: 不出现长周期重复(四色循环那种规律)', () => {
  for (const seed of ['album-1', 'album-2', 'album-77', '张三的书', 'a1b2c3d4-0000-4000-8000-000000000001']) {
    const ids = interiorInkSequence(seed, 40).map((x) => x.id);
    for (const period of [2, 3, 4]) {
      let run = 0;
      let longest = 0;
      for (let i = period; i < ids.length; i += 1) {
        run = ids[i] === ids[i - period] ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      assert.ok(longest + period < 12, `seed=${seed} 出现了 ${longest + period} 页的 ${period} 循环`);
    }
  }
});

test('interiorInkSequence: count 为 0 返回空数组', () => {
  assert.deepEqual(interiorInkSequence('a', 0), []);
});

test('老书三色表原封不动保留,且仍然对比度达标', () => {
  // 本次改动前成稿的第三套书,页面 html 里烘死的就是这三个色。改这张表 = 改已上线
  // 老书的追加页配色,新旧会对不上。它是历史事实,不是设计选择,别去"优化"它。
  assert.deepEqual(LEGACY_THIRD_SET_INTERIOR.map((c) => c.bg), ['#0E2A47', '#12363A', '#14140F']);
  for (const c of LEGACY_THIRD_SET_INTERIOR) {
    assert.ok(contrast(c.body, c.bg) >= 4.5, `${c.id} 正文对比度不足`);
    assert.ok(contrast(c.accent, c.bg) >= 4.5, `${c.id} 标题对比度不足`);
  }
});

test('legacyInteriorInkSequence: 老书按页序三色循环(与改动前逐项一致)', () => {
  assert.deepEqual(
    legacyInteriorInkSequence(7).map((c) => c.bg),
    ['#0E2A47', '#12363A', '#14140F', '#0E2A47', '#12363A', '#14140F', '#0E2A47'],
  );
  // 老书的新色表一个都不能混进来 —— 这正是回落走错表时会看到的样子。
  const legacyBgs = new Set(LEGACY_THIRD_SET_INTERIOR.map((c) => c.bg));
  for (const c of legacyInteriorInkSequence(30)) assert.ok(legacyBgs.has(c.bg));
});

test('coverColorwayById: 认识的返回,不认识的 undefined', () => {
  assert.equal(coverColorwayById('teal')?.bg, '#12363A');
  assert.equal(coverColorwayById('nope'), undefined);
});
