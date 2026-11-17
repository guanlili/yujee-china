#!/usr/bin/env node
// 支付接通自检:一次跑完「配置是否齐 / 线上路由是否活 / 回调是否 fail-closed」。
//
// 用法:
//   node scripts/billing-selftest.mjs                     # 检查本地 shell 环境变量
//   node scripts/billing-selftest.mjs --env-file deploy/china/.env
//   node scripts/billing-selftest.mjs --base-url https://outman.press
//
// 退出码:0 = 全过(允许 warn);1 = 有硬缺口。
// 它不校验商户后台内容(应用是否已签约「电脑网站支付」、价目是否与线上一致只能人工核对,
// 见 docs/specs/2026-11-14-cn-alipay-compliance.md 的上线检查表)。
//
// 2026-11-17:海外卡通道(Waffo / Creem)已整体删除,这个脚本从 Waffo 改成支付宝。

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

// 密钥三把缺任一,checkout 直接 503;人民币价目缺一档,那一档下单 503。
const required = [
  'ALIPAY_APP_ID',
  'ALIPAY_PRIVATE_KEY',
  'ALIPAY_PUBLIC_KEY',
  'ALIPAY_PRICE_PACK_1',
  'ALIPAY_PRICE_PACK_4',
  'ALIPAY_PRICE_PACK_10',
];

const missing = required.filter((k) => !vars[k]);
const alipayEnv = vars.ALIPAY_ENV ?? '(未设置,默认 sandbox)';

console.log(`\n配置来源: ${source}`);
console.log(`ALIPAY_ENV: ${alipayEnv}`);
if (missing.length) {
  console.log(`\n✖ 缺 ${missing.length} 项必填:`);
  for (const k of missing) console.log(`   - ${k}`);
} else {
  console.log('\n✓ 6 项必填 env 齐全');
}

// 价格是经营者定价,脚本只能核对「有没有、是不是正经数字」。
const PRICE_KEYS = ['ALIPAY_PRICE_PACK_1', 'ALIPAY_PRICE_PACK_4', 'ALIPAY_PRICE_PACK_10'];
const badPrices = PRICE_KEYS.filter((k) => vars[k] && !/^\d+(\.\d{1,2})?$/.test(vars[k].trim()));
if (badPrices.length) {
  console.log(`\n✖ 价格格式不对(最多两位小数): ${badPrices.join(', ')}`);
}

console.log('\n人工核对(脚本无法验证):');
console.log('  · 支付宝开放平台的应用是否已签约「电脑网站支付」,应用状态是否「上线」');
console.log('  · 三档人民币价与页面展示、合同口径是否一致(脚本不换算、不带默认价)');
console.log('  · ALIPAY_ENV 是否与即将使用的密钥一致(沙箱私钥打正式网关必然验签失败)');
console.log('  · 配了 ALIPAY_SELLER_ID 时,收款方 PID 是否为本主体');

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
    const r = await fetch(`${baseUrl}/api/v1/billing/checkout-availability`);
    const body = await r.json().catch(() => null);
    const shapeOk = body && typeof body.enabled === 'boolean' && Object.keys(body).length === 1;
    console.log(
      shapeOk
        ? `  ✓ availability 只回布尔(enabled=${body.enabled})`
        : `  ? availability 返回形状异常: ${JSON.stringify(body)}`,
    );
  } catch (e) {
    console.log(`  ✖ availability 不可达: ${String(e)}`);
    ok = false;
  }

  try {
    // 拿一份伪造的异步通知打 webhook:应 4xx(验签失败),绝不能 2xx 通过。
    const r = await fetch(`${baseUrl}/api/webhooks/alipay`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'notify_type=trade_status_sync&trade_status=TRADE_SUCCESS&sign=forged&total_amount=0.01&trade_no=SELFTEST',
    });
    const text = await r.text().catch(() => '');
    // 约定:成功回字面量 success;任何非 2xx 都必须伴随 failure。
    if (r.status >= 400 && r.status < 500) console.log(`  ✓ webhook 拒绝伪造签名(${r.status} ${text})`);
    else {
      console.log(`  ✖ webhook 对伪造签名返回 ${r.status} ${text} —— 验签可能被绕过`);
      ok = false;
    }
  } catch (e) {
    console.log(`  ✖ webhook 不可达: ${String(e)}`);
    ok = false;
  }
  return ok;
}

const probedOk = await probe();
const hardFail = missing.length > 0 || badPrices.length > 0 || !probedOk;
console.log(hardFail ? '\n结果:有硬缺口,先按清单补齐。' : '\n结果:自检通过(剩余为人工核对项)。');
process.exit(hardFail ? 1 : 0);
