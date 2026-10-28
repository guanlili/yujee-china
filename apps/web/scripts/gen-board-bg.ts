// 垫底背景素材:离线批量出图 → 人工筛 → 手动入库。
//
// 跑法:
//   cd apps/web && ARK_IMAGE_API_KEY=<火山key> npx tsx scripts/gen-board-bg.ts [--out <dir>]
//
// 这个脚本**不会**往 public/board-bg/ 写任何东西。产物落在 --out 指定的目录(默认
// 系统临时目录)并附一张 contact-sheet.html,你自己挑完再把选中的图拷进
// public/board-bg/ 并往 src/lib/board-bg/presets.ts 的 IMAGE_PRESETS 加行。
//
// 为什么必须人工筛:2026-08-18 实测 18 张,API 成功率 18/18,实际可用只有 6/18。
// 废图的形态(把纹理画成一本书的实物照、无视排除词画出花卉)程序判不出来,只有人眼能判。
// 把这一步自动化 = 用户会拿到画着玫瑰的底图。

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BACKDROP_TONES,
  TEXTURE_DIRECTIONS,
  buildTexturePrompt,
  type TextureDirection,
  type ToneId,
} from '../src/lib/imagegen/prompt-recipe.ts';
import { createSeedreamProvider } from '../src/lib/imagegen/seedream.ts';

/** 现有 4 张预设是 506×900(9:16 竖版),按同比放大出图,入库前再压。 */
export const BOARD_BG_WIDTH = 1152;
export const BOARD_BG_HEIGHT = 2048;
export const BOARD_BG_SIZE = `${BOARD_BG_WIDTH}x${BOARD_BG_HEIGHT}`;

export type Job = {
  tag: string;
  tone: ToneId;
  hex: string;
  /** 后缀跟死 presetImageUrl():那边拼的是 `/board-bg/<id>.jpg`,写成 .jpeg 入库就是 404。 */
  file: string;
  prompt: string;
  width: number;
  height: number;
  size: string;
};

function assertNoDuplicates(label: string, values: readonly string[]): void {
  const seen = new Set(values);
  if (seen.size !== values.length) throw new Error(`duplicate ${label} in job plan`);
}

export function planJobs(opts: {
  directions: readonly TextureDirection[];
  tones: readonly ToneId[];
}): Job[] {
  // 重复的 tag 会互相覆盖:钱花两份,产物只剩一份,而且人工筛的时候数不出少了哪张。
  assertNoDuplicates('direction', opts.directions);
  assertNoDuplicates('tone', opts.tones);

  const jobs = opts.directions.flatMap((direction) =>
    opts.tones.map((tone) => {
      const known = BACKDROP_TONES.find((t) => t.id === tone);
      if (!known) throw new Error(`unknown tone: ${tone}`);
      const tag = `${direction}-${tone}`;
      return {
        tag,
        tone,
        hex: known.hex,
        file: `${tag}.jpg`,
        prompt: buildTexturePrompt({ direction, tone }),
        width: BOARD_BG_WIDTH,
        height: BOARD_BG_HEIGHT,
        size: BOARD_BG_SIZE,
      };
    }),
  );
  if (jobs.length === 0) throw new Error('nothing to generate: directions or tones is empty');
  return jobs;
}

/** `--out <dir>` 和 `--out=<dir>` 都认;写了 --out 却没给目录就报错,别把产物默默丢别处。 */
export function parseOutDir(argv: readonly string[]): string | null {
  const inline = argv.find((a) => a.startsWith('--out='));
  if (inline) {
    const value = inline.slice('--out='.length);
    if (!value) throw new Error('--out needs a directory');
    return value;
  }
  const index = argv.indexOf('--out');
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--out needs a directory');
  return value;
}

function contactSheet(rows: { tag: string; file: string; hex: string }[]): string {
  const cards = rows
    .map(
      (r) => `<figure><img src="./${r.file}" alt="${r.tag}"><figcaption>${r.tag}
      <span style="background:${r.hex}"></span></figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>垫底背景待筛 ${rows.length} 张</title>
<style>body{margin:0;background:#14151a;color:#e8e6e0;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;padding:28px}
h1{font-size:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px;margin-top:18px}
figure{margin:0}img{width:100%;aspect-ratio:506/900;object-fit:cover;border-radius:6px;display:block;background:#000}
figcaption{font-size:12px;color:#9a9ca6;margin-top:6px;display:flex;align-items:center;gap:6px}
figcaption span{width:12px;height:12px;border-radius:3px;display:inline-block}</style>
<h1>垫底背景待筛 · ${rows.length} 张</h1>
<p style="color:#8d8f99">挑中的拷进 apps/web/public/board-bg/ 并加进 IMAGE_PRESETS。</p>
<div class="g">${cards}</div>`;
}

async function main(): Promise<void> {
  // 走火山 seedream,所以读生图专用的 ARK_IMAGE_API_KEY;ARK_API_KEY 自 2026-10-28
  // 起是 kexiang 中转站 key,对火山无效,仅作旧环境回落。
  const apiKey = process.env.ARK_IMAGE_API_KEY ?? process.env.ARK_API_KEY;
  if (!apiKey) throw new Error('ARK_IMAGE_API_KEY (or ARK_API_KEY) is required');

  const outDir = parseOutDir(process.argv) ?? join(tmpdir(), `board-bg-${process.pid}`);
  mkdirSync(outDir, { recursive: true });

  const jobs = planJobs({ directions: TEXTURE_DIRECTIONS, tones: BACKDROP_TONES.map((t) => t.id) });
  console.log(`${jobs.length} 张,出到 ${outDir}`);

  const provider = createSeedreamProvider({ apiKey });
  const rows: { tag: string; file: string; hex: string }[] = [];
  let tokens = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const result = await provider.generate({
        prompt: job.prompt,
        width: job.width,
        height: job.height,
      });
      writeFileSync(join(outDir, job.file), Buffer.from(result.bytes));
      tokens += result.outputTokens ?? 0;
      rows.push({ tag: job.tag, file: job.file, hex: job.hex });
      console.log(`  OK   ${job.tag}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${job.tag}  ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  writeFileSync(join(outDir, 'contact-sheet.html'), contactSheet(rows), 'utf8');
  console.log(
    `\n出图 ${rows.length}/${jobs.length}(失败 ${failed})  约 ¥${((tokens * 0.02) / 1000).toFixed(2)}` +
      `\n打开 ${join(outDir, 'contact-sheet.html')} 筛图`,
  );
  // 有失败就以非零码退出,和 seed.ts / sitemap-freshness-check.ts 一致:
  // 全军覆没(key 撤了、模型下线)时不能装作跑成功了。
  if (failed > 0) process.exitCode = 1;
}

// 入口守卫与 build-luts.ts 保持一致:被 import(跑测试)时不执行 main。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
