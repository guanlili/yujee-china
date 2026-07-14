import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';

// dev-only:在模板台上改模板 JSON(packages/contracts/templates/<id>.json)。
//
// 两类 op:
//   { slotKey, text } —— 槽位的 `sample`。示例文案的【单一真相】:既是 Web 画板的预览
//     占位(用户没写字时显示),也是写作 LM 的输出示例(engine write_copy 塞进 prompt)。
//     重复组(items.texts)整组共用一个 sample,bracket key 按基名定位。
//   { slotKey, role } —— 槽位的文字类型 title/body/explain/decoration。它决定:主题
//     色/字体怎么刷这个槽(theme-carrier 按 role 分发)、AI 写不写它(decoration 不写)。
//     `variableDecor`(能被主题一键刷的标记)只允许挂在 title/decoration 上 —— 改成
//     body/explain 时会连带摘掉该标记,否则违反契约。
//   { slotKey, variableDecor } —— 该槽能否被主题一键刷色/刷字体。只允许挂在
//     title/decoration 上(打开时会校验当前 role)。
//   { category }      —— 页面类型 cover/toc/interior/ending。
//
// 【外科手术式改写】:模板 JSON 是手写的紧凑格式(一个槽一行)。parse→stringify 会把
// 整个文件重排,一个字段的改动炸成几十行 diff。所以这里只在原文本上替换目标那几个
// 字节,其余格式一字不动。
//
// 写回后的连带同步(不做就会脏):
//   - 任何改动 → 重跑 templates:generate,否则 templates.generated.ts(Web 实际读的)过期、
//     templates:check 变红。
//   - 改 category → 还要重跑 template-previews:generate。烘焙产物按 `category:图槽数`
//     分桶(排版 AI 看的就是这些图),不重烘 template-previews:check 会红。
//
// 生产环境 404(只服务本地模板微调)。

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const WEB_DIR = process.cwd();
const CONTRACTS_DIR = path.resolve(WEB_DIR, '../../packages/contracts');
const TEMPLATE_DIR = path.join(CONTRACTS_DIR, 'templates');
const TEMPLATE_ID_RE = /^[a-z0-9-]+$/;
const SLOT_KEY_RE = /^[a-zA-Z0-9_-]+(\[\d+\])?$/;
const CATEGORIES = ['cover', 'toc', 'interior', 'ending'] as const;
type Category = (typeof CATEGORIES)[number];
const ROLES = ['title', 'body', 'explain', 'decoration'] as const;
type Role = (typeof ROLES)[number];
// `variableDecor`(主题一键刷色/刷字体的标记)只允许挂在这两个 role 上。
const VARIABLE_DECOR_ROLES = new Set<Role>(['title', 'decoration']);

type CopyOp = {
  templateId: string;
  slotKey?: string;
  text?: string;
  role?: Role;
  variableDecor?: boolean;
  category?: Category;
};

type Span = [number, number];

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 字符串感知的括号配对:src[open] 必须是 '[' 或 '{',返回配对闭合括号的下标。
 *  必须跳过字符串字面量 —— sample 文案里可能就带 { } [ ] 字符。 */
function matchBracket(src: string, open: number): number {
  const openCh = src[open]!;
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** key 对应的数组跨度(含首尾方括号)。 */
function arraySpan(src: string, key: string, from = 0): Span | null {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[`, 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m) return null;
  const open = src.indexOf('[', m.index);
  const close = matchBracket(src, open);
  return close < 0 ? null : [open, close + 1];
}

/** 数组里各元素对象的跨度(含首尾花括号)。 */
function objectsIn(src: string, [open, close]: Span): Span[] {
  const out: Span[] = [];
  let i = open + 1;
  let inString = false;
  while (i < close - 1) {
    const ch = src[i]!;
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === '{') {
      const end = matchBracket(src, i);
      if (end < 0) break;
      out.push([i, end + 1]);
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** 全部文字槽数组:顶层 texts + items.texts。 */
function textArraySpans(src: string): Span[] {
  const spans: Span[] = [];
  const top = arraySpan(src, 'texts');
  if (top) spans.push(top);
  const itemsKey = /"items"\s*:\s*\{/.exec(src);
  if (itemsKey) {
    const open = src.indexOf('{', itemsKey.index);
    const close = matchBracket(src, open);
    if (close > 0) {
      const inner = arraySpan(src.slice(0, close), 'texts', open);
      // items 里的 texts 与顶层 texts 不是同一个(顶层的起点在 items 之前)。
      if (inner && inner[0] > open) spans.push(inner);
    }
  }
  return spans;
}

/** 只替换第一处 "category": "..." 的值(模板 JSON 里 category 只在顶层出现)。 */
function setCategory(src: string, next: Category): string | null {
  const re = /("category"\s*:\s*)"[^"]*"/;
  if (!re.test(src)) return null;
  return src.replace(re, `$1"${next}"`);
}

/** 目标文字槽的 `role`。改成 body/explain 时连带摘掉 `variableDecor`(契约只允许它
 *  挂在 title/decoration 上)。返回 null = 槽位没找到;droppedDecor 供调用方回报。 */
function setRole(
  src: string,
  baseId: string,
  role: Role,
): { src: string; droppedDecor: boolean } | null {
  const idNeedle = new RegExp(`"id"\\s*:\\s*"${escapeForRegExp(baseId)}"`);
  for (const arr of textArraySpans(src)) {
    for (const [start, end] of objectsIn(src, arr)) {
      const obj = src.slice(start, end);
      if (!idNeedle.test(obj)) continue;

      const roleRe = /("role"\s*:\s*)"[^"]*"/;
      if (!roleRe.test(obj)) return null;
      let nextObj = obj.replace(roleRe, `$1"${role}"`);

      let droppedDecor = false;
      if (!VARIABLE_DECOR_ROLES.has(role)) {
        const decorRe = /,?\s*"variableDecor"\s*:\s*true/;
        if (decorRe.test(nextObj)) {
          nextObj = nextObj.replace(decorRe, '');
          droppedDecor = true;
        }
      }
      return { src: src.slice(0, start) + nextObj + src.slice(end), droppedDecor };
    }
  }
  return null;
}

/** 目标文字槽的 `variableDecor`(能否被主题一键刷色/刷字体)。契约只允许它挂在
 *  title/decoration 上,所以打开前调用方要先确认 role 合规。 */
function setVariableDecor(src: string, baseId: string, on: boolean): string | null {
  const idNeedle = new RegExp(`"id"\\s*:\\s*"${escapeForRegExp(baseId)}"`);
  for (const arr of textArraySpans(src)) {
    for (const [start, end] of objectsIn(src, arr)) {
      const obj = src.slice(start, end);
      if (!idNeedle.test(obj)) continue;

      const decorRe = /,?\s*"variableDecor"\s*:\s*(?:true|false)/;
      let nextObj: string;
      if (!on) {
        nextObj = decorRe.test(obj) ? obj.replace(decorRe, '') : obj;
      } else if (decorRe.test(obj)) {
        nextObj = obj.replace(decorRe, ', "variableDecor": true');
      } else {
        // 插在 sample 之前(沿用既有字段顺序:id/role/lang/variableDecor/sample)。
        const sampleAt = obj.search(/,\s*"sample"\s*:/);
        if (sampleAt >= 0) {
          nextObj = `${obj.slice(0, sampleAt)}, "variableDecor": true${obj.slice(sampleAt)}`;
        } else {
          const closeAt = obj.lastIndexOf('}');
          const head = obj.slice(0, closeAt).replace(/\s+$/, '');
          nextObj = `${head}, "variableDecor": true }`;
        }
      }
      return src.slice(0, start) + nextObj + src.slice(end);
    }
  }
  return null;
}

/** 目标文字槽当前声明的 role;槽位不存在返回 null。 */
function currentRole(src: string, baseId: string): Role | null {
  const idNeedle = new RegExp(`"id"\\s*:\\s*"${escapeForRegExp(baseId)}"`);
  for (const arr of textArraySpans(src)) {
    for (const [start, end] of objectsIn(src, arr)) {
      const obj = src.slice(start, end);
      if (!idNeedle.test(obj)) continue;
      const role = /"role"\s*:\s*"([^"]*)"/.exec(obj)?.[1];
      return (ROLES as readonly string[]).includes(role ?? '') ? (role as Role) : null;
    }
  }
  return null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 目标文字槽对象里 upsert(或删除)"sample" 字段,其余字节一律不动。 */
function setSample(src: string, baseId: string, text: string): string | null {
  const idNeedle = new RegExp(`"id"\\s*:\\s*"${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  for (const arr of textArraySpans(src)) {
    for (const [start, end] of objectsIn(src, arr)) {
      const obj = src.slice(start, end);
      if (!idNeedle.test(obj)) continue;

      const sampleRe = /,?\s*"sample"\s*:\s*"(?:[^"\\]|\\.)*"/;
      let nextObj: string;
      if (text === '') {
        if (!sampleRe.test(obj)) return src; // 本来就没有,视作已完成
        nextObj = obj.replace(sampleRe, '');
      } else {
        const literal = `"sample": ${JSON.stringify(text)}`;
        if (sampleRe.test(obj)) {
          nextObj = obj.replace(sampleRe, `, ${literal}`);
        } else {
          // 插在闭合花括号之前,沿用「, "k": v }」的既有排版。
          const closeAt = obj.lastIndexOf('}');
          const head = obj.slice(0, closeAt).replace(/\s+$/, '');
          nextObj = `${head}, ${literal} }`;
        }
      }
      return src.slice(0, start) + nextObj + src.slice(end);
    }
  }
  return null; // 槽位没找到
}

async function run(cmd: string, args: string[], cwd: string): Promise<string | null> {
  try {
    await execFileAsync(cmd, args, { cwd, timeout: 120_000 });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function POST(request: Request) {
  if (isProd()) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await request.json()) as { ops?: CopyOp[] };
  const ops = body.ops ?? [];
  if (ops.length === 0) return NextResponse.json({ error: 'ops required' }, { status: 400 });

  for (const op of ops) {
    if (!TEMPLATE_ID_RE.test(op.templateId)) {
      return NextResponse.json({ error: `bad templateId: ${op.templateId}` }, { status: 400 });
    }
    const isRole = op.slotKey !== undefined && op.role !== undefined;
    const isDecor = op.slotKey !== undefined && op.variableDecor !== undefined;
    const isSample = op.slotKey !== undefined && op.text !== undefined;
    const isCategory = op.category !== undefined;
    if ([isSample, isRole, isDecor, isCategory].filter(Boolean).length !== 1) {
      return NextResponse.json(
        { error: '每个 op 只能做一件事:改 sample / 改 role / 改 variableDecor / 改 category' },
        { status: 400 },
      );
    }
    if ((isSample || isRole || isDecor) && !SLOT_KEY_RE.test(op.slotKey!)) {
      return NextResponse.json({ error: `bad slotKey: ${op.slotKey}` }, { status: 400 });
    }
    if (isSample) {
      // 与 contracts/engine 两侧的 sample 校验一致:≤600 字(空串=清除)。
      if (typeof op.text !== 'string' || op.text.length > 600) {
        return NextResponse.json({ error: `bad text: ${op.templateId}/${op.slotKey}` }, { status: 400 });
      }
    }
    if (isRole && !ROLES.includes(op.role!)) {
      return NextResponse.json({ error: `bad role: ${op.role}` }, { status: 400 });
    }
    if (isCategory && !CATEGORIES.includes(op.category!)) {
      return NextResponse.json({ error: `bad category: ${op.category}` }, { status: 400 });
    }
  }

  const failed: string[] = [];
  const notes: string[] = [];
  let applied = 0;
  let categoryChanged = false;

  const byTemplate = new Map<string, CopyOp[]>();
  for (const op of ops) {
    byTemplate.set(op.templateId, [...(byTemplate.get(op.templateId) ?? []), op]);
  }

  for (const [templateId, templateOps] of byTemplate) {
    const file = path.join(TEMPLATE_DIR, `${templateId}.json`);
    let src = await readFile(file, 'utf8').catch(() => null);
    if (src === null) {
      failed.push(`${templateId} (模板 JSON 读不到)`);
      continue;
    }
    let touched = 0;
    for (const op of templateOps) {
      let next: string | null;
      if (op.category !== undefined) {
        const before = /"category"\s*:\s*"([^"]*)"/.exec(src)?.[1];
        next = setCategory(src, op.category);
        if (next !== null && before !== op.category) categoryChanged = true;
      } else if (op.variableDecor !== undefined) {
        const baseId = op.slotKey!.replace(/\[\d+\]$/, '');
        if (op.variableDecor) {
          // 只有 title/decoration 能被主题刷 —— 其它 role 上打开就是违约。
          const role = currentRole(src, baseId);
          if (role === null) {
            failed.push(`${templateId}/${op.slotKey} (槽位未找到)`);
            continue;
          }
          if (!VARIABLE_DECOR_ROLES.has(role)) {
            failed.push(
              `${templateId}/${op.slotKey}: ${role} 槽不能开 variableDecor(主题一键刷只作用于 title/decoration)`,
            );
            continue;
          }
        }
        next = setVariableDecor(src, baseId, op.variableDecor);
      } else if (op.role !== undefined) {
        const result = setRole(src, op.slotKey!.replace(/\[\d+\]$/, ''), op.role);
        next = result?.src ?? null;
        if (result?.droppedDecor) {
          notes.push(
            `${templateId}/${op.slotKey}:${op.role} 不能带 variableDecor(主题一键刷色/刷字体只作用于 title/decoration),已摘掉该标记`,
          );
        }
      } else {
        next = setSample(src, op.slotKey!.replace(/\[\d+\]$/, ''), op.text!);
      }
      if (next === null) {
        failed.push(`${templateId}/${op.slotKey ?? 'category'} (未找到目标字段)`);
        continue;
      }
      src = next;
      touched += 1;
    }
    if (touched === 0) continue;

    // 写盘前先自检:改完的文本必须仍是合法 JSON(外科手术式改写的最后一道闸门)。
    try {
      JSON.parse(src);
    } catch (e) {
      failed.push(`${templateId} (改写后 JSON 非法,已放弃: ${e instanceof Error ? e.message : e})`);
      continue;
    }
    await writeFile(file, src, 'utf8');
    applied += touched;
  }

  let regenerated = false;
  let previewsBaked = false;
  if (applied > 0) {
    const genErr = await run('npx', ['tsx', 'scripts/gen-templates.ts'], CONTRACTS_DIR);
    if (genErr) {
      failed.push('templates:generate 失败,请手动跑 pnpm --filter @yujee/contracts templates:generate');
    } else {
      regenerated = true;
    }
    // category 决定预览的分桶键,改了必须重烘,否则 template-previews:check 会红。
    if (categoryChanged && regenerated) {
      const bakeErr = await run('npx', ['tsx', 'scripts/bake-template-previews.ts'], WEB_DIR);
      if (bakeErr) {
        failed.push('template-previews:generate 失败,请手动跑 pnpm --filter @yujee/web template-previews:generate');
      } else {
        previewsBaked = true;
      }
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    applied,
    failed,
    notes,
    regenerated,
    previewsBaked,
    categoryChanged,
  });
}
