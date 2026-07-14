import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';
import { lintTemplateHtml } from '@yujee/contracts/render/html-template-lint';
import type { TemplateDef } from '@yujee/contracts/templates';

// dev-only:给模板【新增一个文字槽】。
//
// 一个文字槽要合法,必须【同时】落在两处 —— 少一边 templates:check 就红:
//   1) 模板 JSON 的 texts[]:声明 { id, role, lang, variableDecor?, sample? }
//   2) HTML 模板:一个带 data-text-key="<id>" 锚点、内容为 {{TEXT:<id>}} 的元素。
//      锚点与 token 必须成对(lint 硬规则);variableDecor 槽还必须带 {{COLOR:}}/{{FONT:}}。
//      现有模板的惯例是所有文字槽都带 COLOR/FONT token(主题按 role 分发),这里照办。
//
// 槽 id 由【代码自动派号】:按 role 取基名(title/body/explain/label),已被占用就往后
// 顺延序号(title → title2 → title3)。它是技术标识符,不该让人手写 —— 手写只会带来
// 重名、非法字符、命名风格漂移。(仍接受显式传 id,给 API/测试用。)
//
// 新元素绝对定位在一个默认位置,插在根节点末尾(= 文档序最后一个元素)。调用方拿到
// 返回的 elementIndex 就能立刻选中它,用既有的上下左右/宽高编辑器挪到想要的位置。
//
// 写盘前跑同一套 lintTemplateHtml 把关:不合契约就整个放弃,两个文件都不动。
//
// 只支持顶层 texts。items 重复组(bracket token 按容量展开)不在此工具范围内。
//
// 生产环境 404(只服务本地模板微调)。

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const WEB_DIR = process.cwd();
const CONTRACTS_DIR = path.resolve(WEB_DIR, '../../packages/contracts');
const TEMPLATE_DIR = path.join(CONTRACTS_DIR, 'templates');
const HTML_DIR = path.join(CONTRACTS_DIR, 'src/render/html-templates');

const TEMPLATE_ID_RE = /^[a-z0-9-]+$/;
const SLOT_ID_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const ROLES = ['title', 'body', 'explain', 'decoration'] as const;
const LANGS = ['user', 'en'] as const;
type Role = (typeof ROLES)[number];
type Lang = (typeof LANGS)[number];
const VARIABLE_DECOR_ROLES = new Set<Role>(['title', 'decoration']);

// 新槽的默认排版,按 role 给一个像样的起点(位置随后用面板的上下左右调)。
const ROLE_STYLE: Record<Role, string> = {
  title: 'font-size:44px;font-weight:700;line-height:1.15;letter-spacing:0.02em',
  body: 'font-size:18px;line-height:1.7;letter-spacing:0.02em',
  explain: 'font-size:14px;line-height:1.6;letter-spacing:0.02em',
  decoration: 'font-size:12px;letter-spacing:0.2em;text-transform:uppercase',
};
const ROLE_COLOR: Record<Role, string> = {
  title: '#1c1b18',
  body: '#3a3833',
  explain: '#5a574f',
  decoration: '#a09b8e',
};
// 模板里字体栈的引号一律写成 &quot;(它们是 HTML 属性值)。
const DEFAULT_FONT = '&quot;Inter&quot;, &quot;Noto Sans SC&quot;, &quot;PingFang SC&quot;, sans-serif';

type Body = {
  templateId: string;
  /** 省略 = 由代码按 role 自动派号(推荐)。 */
  id?: string;
  role: Role;
  lang: Lang;
  sample?: string;
  variableDecor?: boolean;
};

// role → 槽 id 基名(沿用模板里的既有命名惯例)。
const BASE_ID_BY_ROLE: Record<Role, string> = {
  title: 'title',
  body: 'body',
  explain: 'explain',
  decoration: 'label',
};

/** 按 role 取基名,被占用就顺延序号(title → title2 → title3)。 */
function nextSlotId(taken: Set<string>, role: Role): string | null {
  const base = BASE_ID_BY_ROLE[role];
  if (!taken.has(base)) return base;
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

type TemplateJson = TemplateDef & {
  texts: { id: string; role: string; lang: string; variableDecor?: boolean; sample?: string }[];
};

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** 源码文件 → HTML 字面量(含 ${} 插值,原样保留)。 */
function splitSource(source: string): { head: string; html: string; tail: string } | null {
  const m = /export const [A-Z0-9_]+_HTML = `([\s\S]*)`;\s*$/.exec(source);
  if (!m || m.index === undefined) return null;
  const start = source.indexOf('`', m.index) + 1;
  const end = start + m[1]!.length;
  return { head: source.slice(0, start), html: source.slice(start, end), tail: source.slice(end) };
}

/** 新槽的 HTML 元素:锚点 + {{TEXT}} + {{COLOR}}/{{FONT}}(主题按 role 刷)。 */
function slotElement(body: Body & { id: string }): string {
  const { id, role } = body;
  const decor = body.variableDecor ? ' data-variable-decor' : '';
  const style = [
    'position:absolute',
    'left:60px',
    'top:60px',
    'width:320px',
    ROLE_STYLE[role],
    `color:{{COLOR:${id}|${ROLE_COLOR[role]}}}`,
    `font-family:{{FONT:${id}|${DEFAULT_FONT}}}`,
    'white-space:pre-wrap', // 换行照写照显（模板全量约定）
  ].join(';');
  return `\n  <div data-text-key="${id}"${decor} style="${style}">{{TEXT:${id}}}</div>`;
}

/** 顶层 texts 数组末尾插入新槽声明,沿用「一个槽一行」的紧凑排版(不重排整个文件)。 */
function insertSlotJson(src: string, body: Body & { id: string }): string | null {
  const m = /"texts"\s*:\s*\[/.exec(src);
  if (!m) return null;
  const open = src.indexOf('[', m.index);
  // 字符串感知地找到配对的 ']'(sample 文案里可能带方括号)。
  let depth = 0;
  let inString = false;
  let close = -1;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;

  const fields = [`"id": ${JSON.stringify(body.id)}`, `"role": "${body.role}"`, `"lang": "${body.lang}"`];
  if (body.variableDecor) fields.push('"variableDecor": true');
  if (body.sample) fields.push(`"sample": ${JSON.stringify(body.sample)}`);
  const entry = `    { ${fields.join(', ')} }`;

  // 数组里已有元素 → 给最后一个补逗号；空数组 → 直接放进去。
  const inner = src.slice(open + 1, close);
  const trimmed = inner.replace(/\s+$/, '');
  const next = trimmed.trim() === '' ? `\n${entry}\n  ` : `${trimmed},\n${entry}\n  `;
  return src.slice(0, open + 1) + next + src.slice(close);
}

/** 根节点内后代元素个数(= 浏览器 querySelectorAll('*').length),给调用方定位新元素。 */
function descendantCount(html: string): number {
  const matches = html.match(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*?>/g) ?? [];
  return Math.max(0, matches.length - 1); // 减掉根节点
}

async function regenerate(): Promise<string | null> {
  try {
    await execFileAsync('npx', ['tsx', 'scripts/gen-templates.ts'], {
      cwd: CONTRACTS_DIR,
      timeout: 120_000,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function POST(request: Request) {
  if (isProd()) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await request.json()) as Body;

  if (!TEMPLATE_ID_RE.test(body.templateId ?? '')) {
    return NextResponse.json({ error: `bad templateId: ${body.templateId}` }, { status: 400 });
  }
  // id 可省略(代码自动派号);显式给了才校验格式。
  if (body.id !== undefined && !SLOT_ID_RE.test(body.id)) {
    return NextResponse.json(
      { error: '槽 id 只能是字母开头的字母/数字/下划线（如 subtitle、note2）' },
      { status: 400 },
    );
  }
  if (!ROLES.includes(body.role)) {
    return NextResponse.json({ error: `bad role: ${body.role}` }, { status: 400 });
  }
  if (!LANGS.includes(body.lang)) {
    return NextResponse.json({ error: `bad lang: ${body.lang}` }, { status: 400 });
  }
  if (body.variableDecor && !VARIABLE_DECOR_ROLES.has(body.role)) {
    return NextResponse.json(
      { error: `${body.role} 槽不能开 variableDecor（主题一键刷只作用于 title/decoration）` },
      { status: 400 },
    );
  }
  if (body.sample !== undefined && (typeof body.sample !== 'string' || body.sample.length > 600)) {
    return NextResponse.json({ error: 'sample 必须是 ≤600 字的字符串' }, { status: 400 });
  }

  const jsonFile = path.join(TEMPLATE_DIR, `${body.templateId}.json`);
  const htmlFile = path.join(HTML_DIR, `${body.templateId}.ts`);
  const jsonSrc = await readFile(jsonFile, 'utf8').catch(() => null);
  const htmlSrc = await readFile(htmlFile, 'utf8').catch(() => null);
  if (jsonSrc === null || htmlSrc === null) {
    return NextResponse.json({ error: `${body.templateId} 的模板文件读不到` }, { status: 404 });
  }

  // 槽 id 必须在本模板内唯一(文字槽/图槽/items 都不能重名 —— 它们共用一个寻址空间)。
  const doc = JSON.parse(jsonSrc) as TemplateJson;
  const taken = new Set<string>([
    ...doc.texts.map((s) => s.id),
    ...doc.images.map((s) => s.id),
    ...(doc.items?.texts?.map((s) => s.id) ?? []),
    ...(doc.items?.images?.map((s) => s.id) ?? []),
  ]);
  if (body.id === undefined) {
    const generated = nextSlotId(taken, body.role);
    if (generated === null) {
      return NextResponse.json(
        { error: `${body.templateId} 里 ${body.role} 类的槽号已用尽` },
        { status: 400 },
      );
    }
    body.id = generated;
  } else if (taken.has(body.id)) {
    return NextResponse.json(
      { error: `${body.templateId} 里已经有叫 "${body.id}" 的槽了` },
      { status: 400 },
    );
  }

  const nextJson = insertSlotJson(jsonSrc, body as Body & { id: string });
  if (nextJson === null) {
    return NextResponse.json({ error: '没找到模板 JSON 的 texts 数组' }, { status: 500 });
  }
  const parts = splitSource(htmlSrc);
  if (!parts) {
    return NextResponse.json({ error: '没找到 HTML 模板字面量' }, { status: 500 });
  }
  // 插在根节点的闭合标签之前 → 新元素成为文档序最后一个。
  const closeAt = parts.html.lastIndexOf('</div>');
  if (closeAt < 0) {
    return NextResponse.json({ error: 'HTML 模板没有根节点闭合标签' }, { status: 500 });
  }
  const nextHtml =
    parts.html.slice(0, closeAt) + slotElement(body as Body & { id: string }) + '\n' + parts.html.slice(closeAt);

  // 契约闸门:拿【改完的】模板定义 lint 改完的 HTML。不过就两个文件都不写。
  let nextDoc: TemplateJson;
  try {
    nextDoc = JSON.parse(nextJson) as TemplateJson;
  } catch (e) {
    return NextResponse.json(
      { error: `改写后 JSON 非法,已放弃: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }
  const lintErrors = lintTemplateHtml(nextDoc as TemplateDef, nextHtml);
  if (lintErrors.length > 0) {
    return NextResponse.json(
      { ok: false, failed: lintErrors.map((e) => `${e} —— 已放弃,两个文件都没动`) },
      { status: 400 },
    );
  }

  await writeFile(jsonFile, nextJson, 'utf8');
  await writeFile(htmlFile, parts.head + nextHtml + parts.tail, 'utf8');

  const failed: string[] = [];
  const genErr = await regenerate();
  if (genErr) {
    failed.push('templates:generate 失败,请手动跑 pnpm --filter @yujee/contracts templates:generate');
  }

  return NextResponse.json({
    ok: failed.length === 0,
    failed,
    id: body.id, // 代码派的号,前端据此报给用户 + 选中新元素
    // 新元素在文档序里的下标(= 最后一个),前端据此立刻选中它去调位置。
    elementIndex: descendantCount(nextHtml) - 1,
  });
}
