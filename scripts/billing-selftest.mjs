#!/usr/bin/env node
// 支付接通自检:一次跑完「配置是否齐 / 线上路由是否活 / 回调是否 fail-closed」。
//
// 用法:
//   node scripts/billing-selftest.mjs                     # 检查本地 shell 环境变量
//   node scripts/billing-selftest.mjs --env-file deploy/china/.env
//   node scripts/billing-selftest.mjs --base-url https://outman.press
//
// 退出码:0 = 全过(允许 warn);1 = 有硬缺口。
// 它不校验商户后台内容(商品价格/额度只能人工核对,见 docs/specs/2026-11-14-billing-onboarding.md)。

import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const baseUrl = arg('--base-url', '').replace(/\/$/, '');
const envFile = arg('--env-file', '');

// ── 1. 配置完整性 ───────────────────────────────────────────────────────────
let source = 'process.env';
if (envFile) {
  if (!existsSync(envFile)) {
    console.error(`✖ env 文件不存在: ${envFile}`);
    process.exit(1);
  }
  source = envFile;
}
const vars = {};
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} else {
  for (const [k, v] of Object.entries(process.env)) vars[k] = v ?? '';
}

const required = [
  'WAFFO_MERCHANT_ID',
  'WAFFO_STORE_ID',
  'WAFFO_PRIVATE_KEY',
  'WAFFO_PRODUCT_ID_PACK_1',
  'WAFFO_PRODUCT_ID_PACK_4',
  'WAFFO_PRODUCT_ID_PACK_10',
];

const missing = required.filter((k) => !vars[k]);
const waffoEnv = vars.WAFFO_ENV ?? '(未设置,默认 test)';

console.log(`\n配置来源: ${source}`);
console.log(`WAFFO_ENV: ${waffoEnv}`);
if (missing.length) {
  console.log(`\n✖ 缺 ${missing.length} 项必填:`);
  for (const k of missing) console.log(`   - ${k}`);
} else {
  console.log('\n✓ 6 项必填 env 齐全');
}

// 额度一致性:Product ID 是人工在商户后台建的,这里只能提醒核对。
const PACK_BOOKS = { PACK_1: 20, PACK_4: 80, PACK_10: 200 };
console.log('\n人工核对(脚本无法验证):');
console.log('  · Waffo 后台三个商品的金额/额度是否 = $3/20、$10/80、$20/200');
console.log('  · WAFFO_ENV 是否与即将使用的商户环境一致(test 配 prod 会把真回调全拒)');

// ── 2. 线上路由存活(可选,--base-url) ──────────────────────────────────────
async function probe() {
  if (!baseUrl) {
    console.log('\n(未传 --base-url,跳过线上探测)');
    return true;
  }
  console.log(`\n线上探测: ${baseUrl}`);
  let ok = true;

  try {
    const r = await fetch(`${baseUrl}/api/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packId: 'pack-1' }),
    });
    // 未登录应 401;若 503 说明 provider 未配置(部署后自检的典型结果)。
    if (r.status === 401) console.log('  ✓ checkout 路由存活(未登录 401)');
    else if (r.status === 503) {
      console.log('  ✖ checkout 返回 503 —— 线上 BILLING_NOT_CONFIGURED(env 没进容器)');
      ok = false;
    } else console.log(`  ? checkout 返回 ${r.status}(预期 401)`);
  } catch (e) {
    console.log(`  ✖ checkout 不可达: ${String(e)}`);
    ok = false;
  }

  try {
    // 伪造签名打 webhook:应 4xx(验签失败),绝不能 2xx 通过。
    const r = await fetch(`${baseUrl}/api/webhooks/waffo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-waffo-signature': 'forged' },
      body: '{"eventId":"selftest","mode":"test"}',
    });
    if (r.status >= 400 && r.status < 500) console.log(`  ✓ webhook 拒绝伪造签名(${r.status})`);
    else {
      console.log(`  ✖ webhook 对伪造签名返回 ${r.status} —— 验签可能被绕过`);
      ok = false;
    }
  } catch (e) {
    console.log(`  ✖ webhook 不可达: ${String(e)}`);
    ok = false;
  }
  return ok;
}

const probedOk = await probe();
const hardFail = missing.length > 0 || !probedOk;
console.log(hardFail ? '\n结果:有硬缺口,先按清单补齐。' : '\n结果:自检通过(剩余为人工核对项)。');
process.exit(hardFail ? 1 : 0);
