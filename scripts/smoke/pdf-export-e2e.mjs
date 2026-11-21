// PDF 导出端到端验证:真浏览器点「导出 PDF」,走完
//   画板栅格化 → 生成 PDF blob → 预签名 PUT 直传对象存储 → PUT /pdf 落库确认
// 这一整条链路。只对本地实例跑(它会注册账号、写库、往存储里放文件)。
//
// 前置(见 scripts/smoke/README.md「PDF 导出」一节):
//   1. 本地 PG(yujee-test-pg)+ web dev 实例(3100),env 指向本地 S3 兼容存储;
//   2. 本地假 S3:/tmp/fake-s3.mjs(或 MinIO),CSP 的 connect-src 临时带上它的源;
//   3. Playwright:在一个临时目录 npm i playwright && npx playwright install chromium。
//
// 用法:
//   SMOKE_LOCAL_BASE=http://localhost:3100 node scripts/smoke/pdf-export-e2e.mjs
// 可选覆盖:
//   SMOKE_TEST_DB_CONTAINER  默认 yujee-test-pg
//   SMOKE_STORAGE_DIR        默认 /tmp/fake-s3-data/yujee-test(用来确认对象真的落盘)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const BASE = (process.env.SMOKE_LOCAL_BASE || 'http://localhost:3100').replace(/\/+$/, '');
const DB_CONTAINER = process.env.SMOKE_TEST_DB_CONTAINER || 'yujee-test-pg';
const STORAGE_DIR = process.env.SMOKE_STORAGE_DIR || '/tmp/fake-s3-data/yujee-test';
const PDF_OUT = '/tmp/smoke-pdf-export.pdf';

// 这个脚本会注册账号、建相册、往存储写对象 —— 指到非本地就是往真库塞测试数据。
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`拒绝执行:SMOKE_LOCAL_BASE 必须是 localhost,收到 ${BASE}`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✔ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function psql(sql) {
  // 多行 SQL 经 shell 传参会把换行变成字面 \n —— 先压成单行再交给 psql。
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(`docker exec ${DB_CONTAINER} psql -U yujee -d yujee -t -A -c ${JSON.stringify(oneLine)}`, {
    encoding: 'utf8',
  }).trim();
}

async function main() {
  // playwright 不进仓库依赖(它只在本地做这一条交互验证),所以允许用
  // SMOKE_PLAYWRIGHT_DIR 指到临时安装目录;不设就按常规项目依赖解析。
  let playwright;
  try {
    if (process.env.SMOKE_PLAYWRIGHT_DIR) {
      const req = createRequire(path.join(process.env.SMOKE_PLAYWRIGHT_DIR, 'noop.js'));
      playwright = await import(pathToFileURL(req.resolve('playwright')).href);
    } else {
      playwright = await import('playwright');
    }
  } catch {
    console.error('需要 playwright:在一个临时目录 npm i playwright && npx playwright install chromium,');
    console.error('运行时加 SMOKE_PLAYWRIGHT_DIR=<该目录>。');
    process.exit(2);
  }

  console.log(`\n== 0. 前置检查 on ${BASE} ==`);
  const ping = await fetch(`${BASE}/zh`).catch(() => null);
  ok('本地实例可达', !!ping && ping.status === 200, ping ? `status=${ping.status}` : 'unreachable');
  if (!ping || ping.status !== 200) process.exit(1);

  console.log('\n== 1. 建测试账号与相册 ==');
  const EMAIL = `smoke-pdf-${Date.now()}@example.test`;
  const PASSWORD = 'SmokePdf123!';
  const su = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'PDF Smoke' }),
  });
  const suJson = await su.json().catch(() => null);
  const userId = suJson?.user?.id ?? null;
  ok('邮箱注册成功', su.status === 200 && !!userId, `status=${su.status} ${su.status === 403 ? '(better-auth 要求 Origin 头)' : ''}`);
  if (!userId) process.exit(1);

  psql(`update users set email_verified=true where email='${EMAIL}'`);

  const si = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookies = (si.headers.getSetCookie?.() || []).map((c) => {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
  });
  ok('登录拿到会话 cookie', si.status === 200 && cookies.length > 0, `status=${si.status} cookies=${cookies.length}`);

  // returning id 的输出会和 command tag("INSERT 0 1")混在一行,只取 UUID 段。
  const inserted = psql(
    `insert into albums (user_id,title,status,stage,prompt,photo_count,page_count)
     values ('${userId}','PDF 导出验证','EDITING','ready','smoke pdf export',2,2) returning id`,
  );
  const albumId = (inserted.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0] ?? '';
  ok('建相册行', !!albumId, inserted.slice(0, 120));

  // V3 草稿 + 两页:让 authoring 壳能渲染出画板(否则页面报「还没有草稿」);
  // 章级 done 全覆盖 + stage='ready' 才解锁导出闸门。
  const draft = JSON.stringify({
    version: 'v3-story',
    tree: {
      chapters: [
        {
          chapterId: 'c1',
          title: '第一章',
          description: '',
          chapterContext: '',
          place: '',
          keywords: [],
          extractedColor: null,
          accentColor: null,
          artFont: null,
          photos: [
            {
              photoId: 'p1',
              sceneDescription: '冒烟测试照片',
              width: 1200,
              height: 1600,
              orientation: 'portrait',
              composition: null,
              takenAt: null,
            },
          ],
        },
      ],
    },
    pages: [
      { pageIndex: 0, templateId: 'mag-01', images: {}, texts: { title: 'PDF 导出验证' } },
      { pageIndex: 1, templateId: 'mag-02', images: {}, texts: { title: '第二页' } },
    ],
    progress: { currentChapterId: null, doneChapterIds: ['c1'] },
  });
  psql(`update albums set draft_json='${draft}'::jsonb where id='${albumId}'`);
  psql(
    `insert into draft_pages (album_id,page_index,page,version) values
     ('${albumId}',0,'{"pageIndex":0,"templateId":"mag-01","images":{},"texts":{"title":"PDF 导出验证"}}'::jsonb,1),
     ('${albumId}',1,'{"pageIndex":1,"templateId":"mag-02","images":{},"texts":{"title":"第二页"}}'::jsonb,1)`,
  );
  ok('草稿与页面就绪', psql(`select count(*) from draft_pages where album_id='${albumId}'`) === '2');

  console.log('\n== 2. 浏览器点导出 ==');
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(cookies.map((c) => ({ ...c, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });

  const net = { sign: 0, put: 0, confirm: 0, putStatus: 0 };
  page.on('response', (r) => {
    const u = r.url();
    if (/\/pdf-upload-url$/.test(u)) net.sign += 1;
    if (/\/pdf$/.test(u) && r.request().method() === 'PUT') {
      net.confirm += 1;
      net.putStatus = r.status();
    }
    if (!u.includes('localhost:3100') && r.request().method() === 'PUT') net.put += 1;
  });

  await page.goto(`${BASE}/zh/album/${albumId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  async function clickVisible(selector, label) {
    const loc = page.locator(selector);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      if (await loc.nth(i).isVisible().catch(() => false)) {
        await loc.nth(i).click();
        return true;
      }
    }
    console.log(`  ✖ 找不到可见的「${label}」`);
    return false;
  }

  const menuOpened = await clickVisible('button:has-text("导出 PDF")', '导出 PDF');
  ok('打开导出菜单', menuOpened);
  await page.waitForTimeout(1200);
  const picked = await clickVisible('text=整本 PDF', '整本 PDF');
  ok('选「整本 PDF」', picked);
  await page.waitForTimeout(1000);
  const go = await clickVisible('button:has-text("继续导出")', '继续导出');
  ok('点「继续导出」', go);

  const dlPromise = page.waitForEvent('download', { timeout: 240000 });
  let downloaded = null;
  try {
    const dl = await dlPromise;
    await dl.saveAs(PDF_OUT);
    downloaded = true;
  } catch {
    await page.screenshot({ path: '/tmp/smoke-pdf-export-fail.png' });
  }
  ok('浏览器下载到 PDF', !!downloaded, downloaded ? '' : '截图 /tmp/smoke-pdf-export-fail.png');

  if (downloaded) {
    const st = fs.statSync(PDF_OUT);
    const head = fs.readFileSync(PDF_OUT).subarray(0, 8).toString('latin1');
    ok('下载文件是 PDF', head.startsWith('%PDF-'), head);
    ok('体积合理(>50KB)', st.size > 50 * 1024, `${(st.size / 1024).toFixed(0)}KB`);
  }

  console.log('\n== 3. 直传与落库 ==');
  await page.waitForTimeout(10000); // 上传 + confirm 在下载后异步进行
  ok('调用 pdf-upload-url 取签名', net.sign > 0, `count=${net.sign}`);
  ok('预签名 PUT 成功', net.put > 0, `count=${net.put}`);
  ok('PUT /pdf 确认 200', net.putStatus === 200, `status=${net.putStatus}`);

  const dbKey = psql(`select coalesce(pdf_r2_key,'') from albums where id='${albumId}'`);
  const status = psql(`select status from albums where id='${albumId}'`);
  ok('DB 落 pdf_r2_key', /^pdfs\//.test(dbKey), dbKey || '(空)');
  ok('相册状态翻 COMPLETED', status === 'COMPLETED', status);
  ok(
    'key 在相册命名空间内',
    dbKey.startsWith(`pdfs/${albumId}/`) && dbKey.endsWith('.pdf'),
    dbKey,
  );

  const objPath = path.join(STORAGE_DIR, dbKey);
  const objOk = !!dbKey && fs.existsSync(objPath);
  ok('对象存储里存在该 PDF', objOk, objPath);
  if (objOk && downloaded) {
    ok('存储对象与下载件字节一致', fs.statSync(objPath).size === fs.statSync(PDF_OUT).size);
  }

  if (errors.length) console.log(`  (页面 console.error ${errors.length} 条,首条: ${errors[0]})`);

  await browser.close();

  console.log('\n== 4. 清理 ==');
  psql(`delete from albums where id='${albumId}'`);
  psql(`delete from users where id='${userId}'`);
  ok('清掉测试相册与账号', psql(`select count(*) from users where email='${EMAIL}'`) === '0');

  console.log(`\n合计 ${pass}/${pass + fail} 通过`);
  if (fail) {
    console.log('失败项:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

await main();
