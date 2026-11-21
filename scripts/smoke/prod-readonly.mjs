// 线上只读冒烟:按 sitemap 全量可达性 + SEO 契约 + 鉴权 + fail-closed 支付通道。
// 只发 GET/HEAD 与必然被拒的负向请求,不写任何数据,可以安全地对生产跑。
//
// 用法:
//   node scripts/smoke/prod-readonly.mjs                      # 默认 https://outman.press
//   SMOKE_BASE_URL=http://localhost:8080 node scripts/smoke/prod-readonly.mjs
//
// 判据全部是「机器可判定」的:HTTP 状态、title/lang/canonical/hreflang、运营主体
// 字样、header 是否存在。不校验文案表述,文案改动不该让冒烟变红。
const BASE = (process.env.SMOKE_BASE_URL || 'https://outman.press').replace(/\/$/, '');
const LOCALES = ['zh', 'en', 'ja', 'es', 'fr'];

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function get(path, opts = {}) {
  const r = await fetch(BASE + path, { redirect: 'manual', ...opts });
  const body = opts.readBody === false ? '' : await r.text().catch(() => '');
  return { status: r.status, headers: r.headers, body, loc: r.headers.get('location') || '' };
}

console.log(`\n== 1. sitemap 驱动：索引页全量可达 (${BASE}) ==`);
const sm = await get('/sitemap.xml');
ok('sitemap.xml 200', sm.status === 200, `status=${sm.status}`);
const urls = [...sm.body.matchAll(/<loc>([^<]+)</g)].map((m) => m[1]);
ok('sitemap 有 URL', urls.length > 0, `${urls.length} 条`);

for (const u of urls) {
  const p = u.replace(BASE, '') || '/';
  const r = await get(p);
  const hasTitle = /<title>[^<]{2,}<\/title>/.test(r.body);
  const hasLang = /<html[^>]+lang="(zh|zh-CN|zh-Hans|en|ja|es|fr)"/.test(r.body);
  const noindex = /name="robots" content="noindex/.test(r.body);
  const canonical = (/<link rel="canonical" href="([^"]+)"/.exec(r.body) || [])[1] || '';
  const hreflangs = [...r.body.matchAll(/hrefLang="([^"]+)"/gi)].map((m) => m[1]);
  const h1 = [...r.body.matchAll(/<h1[^>]*>/g)].length;
  const canonOk = canonical === BASE + p;
  // guides 只有英文版(availableLocales=['en']),集群 = en + x-default 两条;
  // 其余路由五语种 = 5 + x-default。判据是「集群唯一且含当前语种」,不写死条数。
  const cur = p.split('/')[1];
  const hreflangOk =
    hreflangs.length >= 2 && new Set(hreflangs).size === hreflangs.length && hreflangs.includes(cur);
  ok(
    `GET ${p}`,
    r.status === 200 && hasTitle && hasLang && !noindex && canonOk && hreflangOk && h1 === 1,
    `status=${r.status} title=${hasTitle} lang=${hasLang} canonical=${canonOk ? 'ok' : canonical} hreflang=${hreflangs.length} h1=${h1}`,
  );
}

console.log('\n== 2. 五语种首页与法律页（运营主体必须在页脚） ==');
for (const loc of LOCALES) {
  for (const path of ['', '/privacy', '/terms', '/refund']) {
    const r = await get(`/${loc}${path}`);
    const hasEntity = r.body.includes('北京知景方略信息科技有限责任公司');
    ok(`/${loc}${path} 200 + 运营主体在页脚`, r.status === 200 && hasEntity, `status=${r.status} entity=${hasEntity}`);
  }
}

console.log('\n== 3. 章节站（/pet /travel /palace × 五语种） ==');
for (const loc of LOCALES) {
  for (const ch of ['pet', 'travel', 'palace']) {
    const r = await get(`/${loc}/${ch}`);
    const assets = [...r.body.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|woff2?|ttf|png|jpg|svg))"/g)].map((m) => m[1]);
    ok(`/${loc}/${ch} 200`, r.status === 200, `status=${r.status} assets=${assets.length}`);
    if (assets.length) {
      const a = await get(assets[0], { readBody: false });
      ok(`  └ 资源 ${assets[0].slice(0, 60)}`, a.status === 200, `status=${a.status}`);
    }
  }
}

console.log('\n== 4. 字体资源（收敛单一源后仍可访问） ==');
for (const f of [
  '/chapters/palace/fonts/CormorantGaramond.ttf',
  '/chapters/palace/fonts/NotoSerifSC-Palace.woff2',
  '/chapters/travel/fonts/CormorantGaramond.ttf',
]) {
  const r = await fetch(BASE + f, { method: 'HEAD' });
  const len = r.headers.get('content-length');
  ok(`HEAD ${f}`, r.status === 200 && Number(len) > 0, `status=${r.status} bytes=${len}`);
}

console.log('\n== 5. 鉴权跳转（游客不得进账号页） ==');
for (const p of ['/zh/settings', '/zh/my-albums', '/zh/credits', '/en/settings', '/ja/my-albums']) {
  const r = await get(p);
  const toLogin = (r.status === 307 || r.status === 302 || r.status === 303) && r.loc.includes('/login');
  ok(`${p} 跳登录`, toLogin, `status=${r.status} -> ${r.loc}`);
}

console.log('\n== 6. 登录/注册页（可抓但 noindex） ==');
for (const p of ['/zh/login', '/zh/register', '/en/forgot-password', '/zh/reset-password']) {
  const r = await get(p);
  const noindex = /name="robots" content="noindex/.test(r.body);
  ok(`${p} 200 + noindex`, r.status === 200 && noindex, `status=${r.status} noindex=${noindex}`);
}

console.log('\n== 7. 支付相关 API（未开通时必须 fail-closed） ==');
const av = await get('/api/v1/billing/checkout-availability');
let avJson = null;
try {
  avJson = JSON.parse(av.body);
} catch {
  avJson = null;
}
ok(
  'checkout-availability 形状',
  av.status === 200 && avJson && typeof avJson.enabled === 'boolean' && Object.keys(avJson).length === 1,
  av.body.slice(0, 80),
);

const ck = await get('/api/v1/billing/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ packId: 'pack-1' }),
});
ok('checkout 未登录 401', ck.status === 401, `status=${ck.status}`);

// 未配密钥时 webhook 必须拒绝伪造签名;配了密钥后这条同样成立(签名还是伪造的)。
const wh = await get('/api/webhooks/alipay', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'trade_status=TRADE_SUCCESS&total_amount=0.01&trade_no=SMOKE&sign=forged',
});
ok(
  'alipay webhook 拒绝伪造签名',
  wh.status >= 400 && wh.status < 500 && /failure/i.test(wh.body),
  `status=${wh.status} body=${wh.body.slice(0, 40)}`,
);

const health = await get('/api/v1/health');
ok('health 200', health.status === 200, `status=${health.status} ${health.body.slice(0, 40)}`);

console.log('\n== 8. 已删除通道不得复活 ==');
for (const p of ['/zh', '/zh/pricing', '/en/pricing', '/zh/privacy', '/zh/terms']) {
  const r = await get(p);
  const leaked = /waffo|creem/i.test(r.body);
  ok(`${p} 无 waffo/creem 字样`, !leaked, leaked ? '页面仍出现旧通道名' : '');
}
for (const p of ['/api/webhooks/waffo', '/api/webhooks/creem', '/api/auth/creem/webhook']) {
  const r = await get(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok(`${p} 已下线（404/405）`, r.status === 404 || r.status === 405, `status=${r.status}`);
}

console.log('\n== 9. SEO/机器可读文件 ==');
for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
  const r = await get(p);
  ok(`${p} 200`, r.status === 200, `status=${r.status} len=${r.body.length}`);
}

console.log('\n== 10. 安全响应头 ==');
const home = await get('/zh', { readBody: false });
for (const h of ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'strict-transport-security']) {
  const v = home.headers.get(h);
  ok(`首页 ${h}`, !!v, v || '(缺失)');
}

console.log('\n== 11. 404 与尾斜杠 ==');
const nf = await get('/zh/no-such-page-smoke');
ok('未知页 404', nf.status === 404, `status=${nf.status}`);
const slash = await get('/zh/palace/');
ok('/zh/palace/ 不是 5xx', slash.status < 500, `status=${slash.status}`);

console.log(`\n结果：${pass} 项通过 / ${fail} 项失败`);
if (fail) {
  console.log('\n失败清单：');
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);
