// 本地实例冒烟:跑登录后的主流程(注册 → 验证 → 会话 → 相册 → 支付 fail-closed → 退出)。
// 会新建一个一次性测试账号与相册,跑完不清理 —— 因此只允许指向本地/测试实例,
// 绝不能指向生产。脚本自己会拒绝非 localhost 的 BASE。
//
// 前置:
//   docker start yujee-test-pg
//   set -a; . /tmp/dev.env; set +a
//   npx pnpm@9 dev -p 3100        # 另开一个终端
//
// 用法:
//   node scripts/smoke/local-flow.mjs
//   SMOKE_LOCAL_BASE=http://localhost:3100 SMOKE_TEST_DB_CONTAINER=yujee-test-pg node scripts/smoke/local-flow.mjs
const BASE = process.env.SMOKE_LOCAL_BASE || 'http://localhost:3100';
const DB_CONTAINER = process.env.SMOKE_TEST_DB_CONTAINER || 'yujee-test-pg';
const EMAIL = `functional-${Date.now()}@example.test`;
const PASSWORD = 'Test1234!test';

if (!/^(http:\/\/localhost|http:\/\/127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`拒绝执行：这是会写数据的冒烟脚本，BASE 必须是本地实例，当前是 ${BASE}`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
const failures = [];
function ok(n, c, d = '') {
  if (c) {
    pass += 1;
    console.log(`  ✓ ${n}${d ? ` — ${d}` : ''}`);
  } else {
    fail += 1;
    failures.push(`${n}${d ? ` — ${d}` : ''}`);
    console.log(`  ✖ ${n}${d ? ` — ${d}` : ''}`);
  }
}

let cookie = '';
let token = '';
let frozenCookie = '';
async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    redirect: 'manual',
    ...opts,
    headers: {
      Origin: BASE,
      ...(opts.headers || {}),
      ...(cookie ? { cookie } : {}),
      ...(token && path.startsWith('/api/') ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const setC = r.headers.getSetCookie?.() || [];
  if (setC.length && !frozenCookie) cookie = setC.map((c) => c.split(';')[0]).join('; ');
  const text = opts.readBody === false ? '' : await r.text().catch(() => '');
  return { status: r.status, loc: r.headers.get('location') || '', text, headers: r.headers };
}

console.log(`\n== 1. 注册与登录（better-auth email）on ${BASE} ==`);
const su = await req('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: '功能测试' }),
});
ok('邮箱注册成功', su.status === 200 && /"user"/.test(su.text), `status=${su.status} ${su.text.slice(0, 80)}`);
ok('注册返回 isAnonymous=false', su.status === 200 && /"isAnonymous":false/.test(su.text), su.text.slice(0, 60));

// 本实例开了邮箱验证:注册不直接发会话,置 email_verified 后再登录拿 cookie。
const { execSync } = await import('node:child_process');
execSync(
  `docker exec ${DB_CONTAINER} psql -U yujee -d yujee -c "update users set email_verified=true where email='${EMAIL}'"`,
  { stdio: 'ignore' },
);
const si = await req('/api/auth/sign-in/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
ok('邮箱验证后登录成功', si.status === 200 && /"token"|"user"/.test(si.text), `status=${si.status} ${si.text.slice(0, 60)}`);
let siJson = null;
try {
  siJson = JSON.parse(si.text);
} catch {
  siJson = null;
}
token = siJson?.token || '';
frozenCookie = cookie;
ok('登录后拿到会话 token', token.length > 0, token.slice(0, 12));

console.log('\n== 2. 会话与用户信息 ==');
const me = await req('/api/v1/user/me');
ok('GET /api/v1/user/me 200', me.status === 200, `status=${me.status}`);
let meJson = null;
try {
  meJson = JSON.parse(me.text);
} catch {
  meJson = null;
}
ok(
  'me 返回 email 与游客标记',
  !!meJson && /@example\.test/.test(me.text) && typeof (meJson?.data?.isAnonymous ?? meJson?.data?.anonymous) === 'boolean',
  me.text.slice(0, 100),
);

console.log('\n== 3. 积分账户 ==');
const bal = await req('/api/v1/credit/balance');
ok('积分余额 200', bal.status === 200, `status=${bal.status} ${bal.text.slice(0, 60)}`);
const hist = await req('/api/v1/credit/history');
ok('积分流水 200', hist.status === 200, `status=${hist.status}`);

console.log('\n== 4. 相册创建与读取 ==');
const created = await req('/api/v3/albums', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ photos: [], title: '功能测试相册' }),
});
let albumId = null;
try {
  const parsed = JSON.parse(created.text);
  albumId = parsed?.data?.uuid || parsed?.data?.id || null;
} catch {
  albumId = null;
}
ok(
  '创建相册（v3，空照片应返回业务错误而非 5xx）',
  created.status === 200 || created.status === 400 || created.status === 422,
  `status=${created.status} id=${albumId} ${created.text.slice(0, 80)}`,
);
const list = await req('/api/v1/albums');
ok('相册列表包含新相册', list.status === 200 && (!albumId || list.text.includes(albumId)), `status=${list.status}`);

console.log('\n== 5. 登录后页面（不再被踢回登录页） ==');
for (const p of ['/zh/settings', '/zh/my-albums', '/zh/credits', '/en/settings']) {
  const r = await req(p);
  const bounced = (r.status === 307 || r.status === 302) && r.loc.includes('/login');
  ok(`${p} 已登录可访问`, r.status === 200 && !bounced, `status=${r.status} loc=${r.loc}`);
}

console.log('\n== 6. 支付链路（未配密钥时必须 503，绝不生成跳转 URL） ==');
const ck = await req('/api/v1/billing/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ packId: 'pack-1' }),
});
ok(
  '登录用户下单被拒 503',
  ck.status === 503 && /BILLING_NOT_CONFIGURED|not_configured/i.test(ck.text),
  `status=${ck.status} ${ck.text.slice(0, 80)}`,
);
const av = await req('/api/v1/billing/checkout-availability');
let avJson = null;
try {
  avJson = JSON.parse(av.text);
} catch {
  avJson = null;
}
ok('可用性只回布尔且为 false', av.status === 200 && avJson && avJson.enabled === false && Object.keys(avJson).length === 1, av.text.slice(0, 60));
const billing = await req('/api/v1/user/billing');
ok('用户账单 200', billing.status === 200, `status=${billing.status}`);

console.log('\n== 7. 继承性回归：游客仍被拦，公开页仍可达 ==');
const saved = cookie;
cookie = '';
const guestSettings = await req('/zh/settings');
ok('无 cookie 访问设置页跳登录', guestSettings.status === 307 && guestSettings.loc.includes('/login'), `status=${guestSettings.status} -> ${guestSettings.loc}`);
const guestHome = await req('/zh');
ok('无 cookie 首页 200', guestHome.status === 200, `status=${guestHome.status}`);
const guestCheckout = await req('/api/v1/billing/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ packId: 'pack-1' }),
});
ok('无 cookie 下单 401', guestCheckout.status === 401, `status=${guestCheckout.status}`);
cookie = saved;

console.log('\n== 8. 敏感接口鉴权 ==');
for (const p of ['/api/v1/admin/model-config']) {
  const r = await req(p);
  ok(`${p} 普通用户被拒`, r.status === 401 || r.status === 403, `status=${r.status}`);
}

console.log('\n== 9. 退出登录后会话失效 ==');
const out = await req('/api/auth/sign-out', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
ok('sign-out 200', out.status === 200, `status=${out.status}`);
token = '';
cookie = '';
const after = await req('/api/v1/user/me');
ok('退出后 me 401', after.status === 401, `status=${after.status}`);

console.log(`\n结果：${pass} 项通过 / ${fail} 项失败  (测试账号 ${EMAIL})`);
if (fail) {
  console.log('失败清单：');
  failures.forEach((f) => console.log(`  - ${f}`));
}
process.exit(fail ? 1 : 0);
