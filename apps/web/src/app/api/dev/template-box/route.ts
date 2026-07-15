import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';
import { TEMPLATES } from '@yujee/contracts/templates';
import { lintTemplateHtml } from '@yujee/contracts/render/html-template-lint';

const execFileAsync = promisify(execFile);

// dev-only:把模板台上手调的版面写回 HTML 模板源码
// packages/contracts/src/render/html-templates/<id>.ts。
//
// 支持三类操作:
//   set   —— 改 style 里的 width/height/top/left/right/bottom(px)
//   remove—— 删掉整个元素(装饰层、多余文字块…)
//
// 元素定位:
//   { elementIndex } —— 模板根节点内的文档序号(= 浏览器 querySelectorAll('*') 的下标)。
//                       填充只替换属性值和文本,不动元素结构,所以渲染 DOM 的序号
//                       与源码里开标签的出现顺序一一对应。
//   { slotType, slotId } —— 按锚点定位(批量固化文字框高度还在用)。
//
// 删除的闸门 = 契约本身:删完立刻用 lintTemplateHtml 跑一遍锚点校验,过不了就整个拒绝。
// 于是「图槽还被 JSON 声明着不能删」「文字槽 token 还在别处用着不能删」这类破坏
// 会在写盘前被挡住,并把原因原样告诉调用方。
//
// 生产环境 404(只服务本地模板微调)。

export const runtime = 'nodejs';

const TEMPLATE_DIR = path.resolve(
  process.cwd(),
  '../../packages/contracts/src/render/html-templates',
);
const CONTRACTS_DIR = path.resolve(process.cwd(), '../../packages/contracts');
const TEMPLATE_JSON_DIR = path.join(CONTRACTS_DIR, 'templates');
const TEMPLATE_ID_RE = /^[a-z0-9-]+$/;
const SLOT_ID_RE = /^[a-zA-Z0-9_-]+(\[\d+\])?$/;
const SIDES = ['width', 'height', 'top', 'left', 'right', 'bottom'] as const;
type Side = (typeof SIDES)[number];

// 模板里出现过的全部标签(见 grep 统计)。img/br 无闭合标签;svg 子元素自闭合。
const VOID_TAGS = new Set(['img', 'br']);

type Target = { elementIndex?: number; slotType?: 'text' | 'image'; slotId?: string };
type BoxOp = Target & {
  templateId: string;
  set?: Partial<Record<Side, number>>;
  remove?: boolean;
};

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 源码文件 → HTML 字面量(含 ${} 插值,原样保留)。lint 只看锚点/token,插值不影响。 */
function splitSource(source: string): { head: string; html: string; tail: string } | null {
  const m = /export const [A-Z0-9_]+_HTML = `([\s\S]*)`;\s*$/.exec(source);
  if (!m || m.index === undefined) return null;
  const htmlStart = source.indexOf('`', m.index) + 1;
  const htmlEnd = htmlStart + m[1]!.length;
  return {
    head: source.slice(0, htmlStart),
    html: source.slice(htmlStart, htmlEnd),
    tail: source.slice(htmlEnd),
  };
}

type Element = { index: number; tag: string; open: [number, number]; end: number };

/** 根节点内的后代元素,与浏览器 `root.querySelectorAll('*')` 完全同序同集合。
 *
 * scanElements 会把根节点(`<div data-template=...>`)算作第 0 个,而 querySelectorAll('*')
 * 【不含】根自身 —— 差一位就会改错/删错元素,所以这里统一丢掉根。 */
function descendants(html: string): Element[] {
  return scanElements(html)
    .slice(1)
    .map((el, index) => ({ ...el, index }));
}

/** 按文档序枚举 HTML 里的元素(含根),给出各自的完整跨度。 */
function scanElements(html: string): Element[] {
  const out: Element[] = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1]!.toLowerCase();
    const selfClosing = m[2] === '/' || VOID_TAGS.has(tag);
    const openStart = m.index;
    const openEnd = m.index + m[0].length;
    let end = openEnd;
    if (!selfClosing) {
      // 同名标签按深度配对，找到属于本元素的闭合标签。
      const nestRe = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*?(/?)>|</${escapeRegExp(tag)}>`, 'g');
      nestRe.lastIndex = openEnd;
      let depth = 1;
      let n: RegExpExecArray | null;
      while ((n = nestRe.exec(html)) !== null) {
        if (n[0].startsWith('</')) {
          depth -= 1;
          if (depth === 0) {
            end = n.index + n[0].length;
            break;
          }
        } else if (n[1] !== '/') {
          depth += 1;
        }
      }
    }
    out.push({ index, tag, open: [openStart, openEnd], end });
    index += 1;
  }
  return out;
}

/** style 声明串里 upsert 一条 width/height/top/left/right/bottom。 */
function upsertDeclaration(style: string, prop: Side, px: number): string {
  const re = new RegExp(`(^|;)(\\s*)${prop}\\s*:[^;"]*`);
  const decl = `${prop}:${px}px`;
  if (re.test(style)) return style.replace(re, `$1$2${decl}`);
  if (style === '' || style.endsWith(';')) return `${style}${decl}`;
  return `${style};${decl}`;
}

/** 按锚点找元素下标(图槽取容器 div，不取 <img>)。 */
function findBySlot(html: string, elements: Element[], slotType: 'text' | 'image', slotId: string): Element | null {
  const attr = slotType === 'text' ? 'data-text-key' : 'data-image-slot';
  const needle = `${attr}="${slotId}"`;
  for (const el of elements) {
    const openTag = html.slice(el.open[0], el.open[1]);
    if (!openTag.includes(needle)) continue;
    if (slotType === 'image' && el.tag === 'img') continue;
    return el;
  }
  return null;
}

function applySet(html: string, el: Element, set: Partial<Record<Side, number>>): string {
  const openTag = html.slice(el.open[0], el.open[1]);
  const styleMatch = /style="([^"]*)"/.exec(openTag);
  let style = styleMatch ? styleMatch[1]! : '';
  for (const side of SIDES) {
    const value = set[side];
    if (value !== undefined) style = upsertDeclaration(style, side, value);
  }
  const nextOpen = styleMatch
    ? openTag.replace(styleMatch[0], `style="${style}"`)
    : openTag.replace(/\/?>$/, (close) => ` style="${style}"${close}`);
  return html.slice(0, el.open[0]) + nextOpen + html.slice(el.open[1]);
}

// ── 朝向提示回写(改完即同步) ────────────────────────────────────────────────
// engine 的 slot_matcher 按模板 JSON 的 `orientation` 提示决定「竖照进竖槽」,而几何
// 真相在 HTML 里 —— 在这里改了框的宽高,JSON 提示不跟着走就会漂移。曾漂出 5 处真实
// 矛盾(mag-04/09/11/13/15):提示只收竖照、框却是横的,竖照被塞进横框裁头,再被排版
// 评委按「照片完整」扣分。所以每次 HTML 写盘成功后,按新宽高把提示改正过来。
// 阈值与 templates.test.ts 的漂移守卫完全一致:>1.15 横、<1/1.15 竖、之间为方(不约束)。

const ASPECT_RATIO = 1.15;

function boxOrientation(w: number, h: number): 'landscape' | 'portrait' | null {
  const aspect = w / h;
  if (aspect > ASPECT_RATIO) return 'landscape';
  if (aspect < 1 / ASPECT_RATIO) return 'portrait';
  return null; // 近方形:任何朝向都不冲突,不写约束
}

/** 最终 HTML 里每个图槽锚点的宽高(键含 items 展开的 `base[i]`)。 */
function imageBoxes(html: string): Map<string, { w: number; h: number }> {
  const out = new Map<string, { w: number; h: number }>();
  for (const m of html.matchAll(/<(?!img\b)[^>]*data-image-slot="([^"]+)"[^>]*>/g)) {
    const style = /style="([^"]*)"/.exec(m[0])?.[1] ?? '';
    const w = /(?:^|;)\s*width:\s*([\d.]+)px/.exec(style)?.[1];
    const h = /(?:^|;)\s*height:\s*([\d.]+)px/.exec(style)?.[1];
    if (w && h) out.set(m[1]!, { w: Number(w), h: Number(h) });
  }
  return out;
}

/** 在 JSON 源码里,slot 对象内 upsert / 删除 orientation —— 只动目标字节,不重排格式。 */
function patchOrientation(src: string, slotId: string, next: 'landscape' | 'portrait' | null): string | null {
  const idNeedle = `"id": "${slotId}"`;
  const at = src.indexOf(idNeedle);
  if (at === -1) return null;
  // 槽对象的边界:从 id 往前找最近的 `{`,再按深度配对到 `}`。槽对象里没有嵌套对象。
  const start = src.lastIndexOf('{', at);
  const end = src.indexOf('}', at);
  if (start === -1 || end === -1) return null;
  const obj = src.slice(start, end + 1);

  const orientRe = /,?\s*"orientation":\s*\[[^\]]*\]/;
  const has = orientRe.test(obj);
  let nextObj: string;
  if (next === null) {
    if (!has) return src; // 本来就没有约束,无事可做
    nextObj = obj.replace(orientRe, '');
  } else {
    const literal = `"orientation": ["${next}"]`;
    if (has) {
      if (obj.includes(literal)) return src; // 已经是对的
      nextObj = obj.replace(/"orientation":\s*\[[^\]]*\]/, literal);
    } else {
      nextObj = obj.replace(idNeedle, `${idNeedle}, ${literal}`);
    }
  }
  return src.slice(0, start) + nextObj + src.slice(end + 1);
}

/** 从模板 JSON 里删掉一个文字槽声明(顶层或 items),只动目标字节。删图层的级联。 */
async function removeTextSlotDeclaration(templateId: string, slotId: string): Promise<boolean> {
  const file = path.join(TEMPLATE_JSON_DIR, `${templateId}.json`);
  const src = await readFile(file, 'utf8').catch(() => null);
  if (src === null) return false;
  const needle = `"id": "${slotId}"`;
  const at = src.indexOf(needle);
  if (at === -1) return false;
  const start = src.lastIndexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (start === -1 || end === -1) return false;
  let before = src.slice(0, start);
  let after = src.slice(end + 1);
  const trailing = /,\s*$/.exec(before);
  if (trailing) before = before.slice(0, trailing.index);
  else {
    const leading = /^\s*,/.exec(after);
    if (leading) after = after.slice(leading[0].length);
  }
  const next = before + after;
  try {
    JSON.parse(next);
  } catch {
    return false; // 删完不再是合法 JSON —— 宁可留着让人手动清,也不写坏文件
  }
  await writeFile(file, next, 'utf8');
  return true;
}

/** HTML 写盘成功后,把该模板 JSON 的 orientation 提示对齐到新几何。返回展示给操作者的说明。 */
async function syncOrientationHints(templateId: string, html: string): Promise<{ notes: string[]; changed: boolean }> {
  const file = path.join(TEMPLATE_JSON_DIR, `${templateId}.json`);
  const src = await readFile(file, 'utf8').catch(() => null);
  if (src === null) return { notes: [`${templateId}.json 不存在,朝向提示未同步`], changed: false };

  const boxes = imageBoxes(html);
  const parsed = JSON.parse(src) as {
    images?: { id: string; orientation?: string[] }[];
    items?: { images?: { id: string; orientation?: string[] }[] };
  };
  const slots = [...(parsed.images ?? []), ...(parsed.items?.images ?? [])];

  let out = src;
  const notes: string[] = [];
  for (const slot of slots) {
    // items 槽对应 HTML 里的 base[i] 多个框;朝向不一致时无法推断,跳过。
    const matched = [...boxes.entries()].filter(([k]) => k === slot.id || k.startsWith(`${slot.id}[`));
    if (matched.length === 0) continue;
    const shapes = new Set(matched.map(([, b]) => boxOrientation(b.w, b.h)));
    if (shapes.size !== 1) continue;
    const next = [...shapes][0]!;

    const current = slot.orientation ?? null;
    const same = next === null ? current === null : current?.length === 1 && current[0] === next;
    if (same) continue;

    const patched = patchOrientation(out, slot.id, next);
    if (patched === null || patched === out) continue;
    out = patched;
    notes.push(
      `${templateId}/${slot.id} 朝向提示 ${current ? JSON.stringify(current) : '(无)'} → ${next ? `["${next}"]` : '(移除,近方形)'}`,
    );
  }

  if (out === src) return { notes, changed: false };
  await writeFile(file, out, 'utf8');
  return { notes, changed: true };
}

function applyRemove(html: string, el: Element): string {
  // 连同元素前面的空白一起删掉，别在源码里留下空行。
  let start = el.open[0];
  while (start > 0 && (html[start - 1] === ' ' || html[start - 1] === '\n')) start -= 1;
  return html.slice(0, start) + html.slice(el.end);
}

export async function POST(request: Request) {
  if (isProd()) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await request.json()) as { ops?: BoxOp[] };
  const ops = body.ops ?? [];
  if (ops.length === 0) return NextResponse.json({ error: 'ops required' }, { status: 400 });

  for (const op of ops) {
    if (!TEMPLATE_ID_RE.test(op.templateId)) {
      return NextResponse.json({ error: `bad templateId: ${op.templateId}` }, { status: 400 });
    }
    if (op.slotId !== undefined && !SLOT_ID_RE.test(op.slotId)) {
      return NextResponse.json({ error: `bad slotId: ${op.slotId}` }, { status: 400 });
    }
    if (op.elementIndex === undefined && (op.slotType === undefined || op.slotId === undefined)) {
      return NextResponse.json({ error: '需要 elementIndex 或 slotType+slotId' }, { status: 400 });
    }
    if (!op.remove) {
      const set = op.set ?? {};
      const values = SIDES.map((s) => set[s]).filter((v) => v !== undefined) as number[];
      if (values.length === 0) {
        return NextResponse.json({ error: 'set 至少要给一个尺寸/位置' }, { status: 400 });
      }
      // 位置允许负值(元素可以移出画面外);尺寸必须为正,统一限制在 ±4000px。
      for (const v of values) {
        if (!Number.isFinite(v) || Math.abs(v) > 4000) {
          return NextResponse.json({ error: `数值越界: ${v}` }, { status: 400 });
        }
      }
      for (const side of ['width', 'height'] as const) {
        const v = set[side];
        if (v !== undefined && v <= 0) {
          return NextResponse.json({ error: `${side} 必须为正数` }, { status: 400 });
        }
      }
    }
  }

  // 按模板聚合;同一模板内先删后改会让下标错位,所以逐 op 顺序应用并每次重扫。
  const byTemplate = new Map<string, BoxOp[]>();
  for (const op of ops) {
    byTemplate.set(op.templateId, [...(byTemplate.get(op.templateId) ?? []), op]);
  }

  const failed: string[] = [];
  const notes: string[] = [];
  let applied = 0;
  let jsonChanged = false;

  for (const [templateId, templateOps] of byTemplate) {
    const template = TEMPLATES[templateId];
    if (!template) {
      failed.push(`${templateId} (模板未注册)`);
      continue;
    }
    const file = path.join(TEMPLATE_DIR, `${templateId}.ts`);
    const source = await readFile(file, 'utf8').catch(() => null);
    if (source === null) {
      failed.push(`${templateId} (源码文件不存在)`);
      continue;
    }
    const parts = splitSource(source);
    if (!parts) {
      failed.push(`${templateId} (没找到 HTML 字面量)`);
      continue;
    }

    let html = parts.html;
    let touched = 0;
    const localFailures: string[] = [];

    for (const op of templateOps) {
      const elements = descendants(html);
      const el =
        op.elementIndex !== undefined
          ? elements[op.elementIndex]
          : findBySlot(html, elements, op.slotType!, op.slotId!);
      if (!el) {
        localFailures.push(
          `${templateId}/${op.slotId ?? `#${op.elementIndex}`} (元素未找到)`,
        );
        continue;
      }
      html = op.remove ? applyRemove(html, el) : applySet(html, el, op.set ?? {});
      touched += 1;
    }

    if (touched === 0) {
      failed.push(...localFailures);
      continue;
    }

    // 删图层的级联:文字元素被删光后,它的 JSON 声明必须跟着删 —— 否则就是「哑槽」
    // (声明着、AI 给它写文案、页面上不显示)。lint 已禁止哑槽,所以这里先按删除后的
    // HTML 算出幸存槽集,用【缩减后的声明】过 lint,写盘后再把 JSON 声明真删掉。
    const surviving = (id: string) => html.includes(`data-text-key="${id}"`);
    const survivingBase = (id: string) => html.includes(`data-text-key="${id}[0]"`);
    const droppedTexts = template.texts.filter((s) => !surviving(s.id)).map((s) => s.id);
    const droppedItemTexts = (template.items?.texts ?? [])
      .filter((s) => !survivingBase(s.id))
      .map((s) => s.id);
    const effective = {
      ...template,
      texts: template.texts.filter((s) => surviving(s.id)),
      ...(template.items
        ? {
            items: {
              ...template.items,
              texts: (template.items.texts ?? []).filter((s) => survivingBase(s.id)),
            },
          }
        : {}),
    };

    // 契约闸门:改完的 HTML 必须仍通过锚点/token 校验,否则整份放弃(不写盘)。
    const lintErrors = lintTemplateHtml(effective, html);
    if (lintErrors.length > 0) {
      failed.push(...lintErrors.map((e) => `${e} —— 已放弃对 ${templateId} 的改动`));
      failed.push(...localFailures);
      continue;
    }

    await writeFile(file, parts.head + html + parts.tail, 'utf8');
    applied += touched;
    failed.push(...localFailures);

    for (const slotId of [...droppedTexts, ...droppedItemTexts]) {
      const cascade = await removeTextSlotDeclaration(templateId, slotId);
      if (cascade) {
        notes.push(`${templateId}/${slotId} 的元素已删光,JSON 声明级联删除`);
        jsonChanged = true;
      } else {
        failed.push(`${templateId}/${slotId}: JSON 声明级联删除失败,请手动清理`);
      }
    }

    // 改完即同步:HTML 几何变了,JSON 的 orientation 配图提示跟着对齐。
    const sync = await syncOrientationHints(templateId, html);
    notes.push(...sync.notes);
    jsonChanged = jsonChanged || sync.changed;
  }

  // JSON 被回写过 → 重新生成 TS 注册表,否则 templates:check 红。
  if (jsonChanged) {
    try {
      await execFileAsync('npx', ['tsx', 'scripts/gen-templates.ts'], {
        cwd: CONTRACTS_DIR,
        timeout: 120_000,
      });
    } catch {
      failed.push('templates:generate 失败,请手动跑 pnpm --filter @yujee/contracts templates:generate');
    }
  }

  return NextResponse.json({ ok: failed.length === 0, applied, failed, notes });
}
