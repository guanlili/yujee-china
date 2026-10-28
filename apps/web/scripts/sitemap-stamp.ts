#!/usr/bin/env tsx
// 打印每个 freshness 路由在 HEAD 上的 sources 内容指纹,方便人手抄进 reviewedSources。
// 不自动改文件 —— 闸门的意义就是逼人先看页面再 stamp。

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { FRESHNESS_DECLARATIONS } from '../src/lib/seo/freshness';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const FRESHNESS = 'apps/web/src/lib/seo/freshness.ts';
const GUIDES_DECL = 'apps/web/src/lib/guides/guides.ts';
const EXCLUDED_PATHS = new Set([FRESHNESS, GUIDES_DECL]);

function sourcesFingerprint(sources: readonly string[]): string {
  let listing = '';
  try {
    listing = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--', ...sources], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch {
    listing = '';
  }
  const filtered = listing
    .split('\n')
    .filter((line) => {
      if (!line) return false;
      const path = line.split('\t')[1] ?? '';
      return !EXCLUDED_PATHS.has(path);
    })
    .join('\n');
  const normalized = filtered.length ? `${filtered}\n` : '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

type Decl = {
  sources: readonly string[];
  updatedAt: string;
  reviewedSources?: string;
  reviewedAt?: string;
};

for (const [route, raw] of Object.entries(FRESHNESS_DECLARATIONS)) {
  const decl = raw as Decl;
  const fp = sourcesFingerprint(decl.sources);
  const declared = decl.reviewedSources ?? decl.reviewedAt ?? '';
  const mark = declared === fp ? 'ok' : 'STALE/NEW';
  console.log(`${route}\t${fp}\tupdatedAt=${decl.updatedAt}\twas=${declared}\t${mark}`);
}
