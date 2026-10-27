import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { authHrefWithFrom, safeAuthRedirect } from '@/lib/auth/redirect';

const srcRoot = join(process.cwd(), 'src');

function source(path: string) {
  return readFileSync(join(srcRoot, path), 'utf8');
}

test('safeAuthRedirect keeps the post-login generation resume path local', () => {
  assert.equal(
    safeAuthRedirect('/zh?resumeGeneration=1', '/zh/my-albums'),
    '/zh?resumeGeneration=1',
  );
  assert.equal(safeAuthRedirect('//evil.test/steal', '/zh/my-albums'), '/zh/my-albums');
  assert.equal(safeAuthRedirect('https://evil.test/steal', '/zh/my-albums'), '/zh/my-albums');
});

test('authHrefWithFrom carries the resume redirect through auth links', () => {
  assert.equal(
    authHrefWithFrom('/zh/register', '/zh?resumeGeneration=1'),
    '/zh/register?from=%2Fzh%3FresumeGeneration%3D1',
  );
  assert.equal(
    authHrefWithFrom('/zh/login', '/zh?resumeGeneration=1'),
    '/zh/login?from=%2Fzh%3FresumeGeneration%3D1',
  );
});

test('login/register pages preserve the generation resume redirect through account creation', () => {
  const loginPage = source('app/[locale]/login/page.tsx');
  const loginForm = source('app/[locale]/login/login-form.tsx');
  const registerPage = source('app/[locale]/register/page.tsx');
  const registerForm = source('app/[locale]/register/register-form.tsx');

  assert.match(
    loginPage,
    /const registerHref = authHrefWithFrom\(`\/\$\{locale\}\/register`, from\);/,
    'login page must pass ?from=... into the register link',
  );
  assert.match(
    loginForm,
    /const dest = safeAuthRedirect\(from, `\/\$\{locale\}\/my-albums`\);/,
    'login form must resolve a safe local post-auth destination',
  );
  assert.match(
    loginForm,
    /authClient\.signIn\.email\(\{ email: identifier, password, callbackURL: dest \}\)/,
    'email sign-in must forward callbackURL so verification redirects resume generation',
  );
  assert.match(
    loginForm,
    /authClient\.signIn\.phoneNumber\(\{\s*phoneNumber: normalizePhoneNumber\(identifier\) \|\| identifier,\s*password,/,
    'phone sign-in must run through the phoneNumber plugin client with normalized input',
  );
  assert.match(
    registerPage,
    /searchParams: Promise<\{ from\?: string \}>/,
    'register page must accept the carried from search param',
  );
  assert.match(
    registerPage,
    /<RegisterForm messages=\{messages\} locale=\{locale\} from=\{from\} \/>/,
    'register page must pass from into the client form',
  );
  assert.match(
    registerForm,
    /authClient\.signUp\.email\(\{ name, email, password, callbackURL: dest \}\)/,
    'signup verification email must carry the resume callbackURL',
  );
  assert.match(
    registerForm,
    /fetch\('\/api\/auth\/phone-signup'/,
    'phone signup must hit the custom better-auth endpoint',
  );
  assert.match(
    registerForm,
    /router\.push\(dest\);/,
    'phone signup (which creates the session immediately) must route to the carried destination',
  );
  assert.match(
    registerForm,
    /authHrefWithFrom\(`\/\$\{locale\}\/login`, from\)/,
    'register form login links must preserve the carried from param',
  );
});

test('phone auth forms share one normalizer; conflicts guide the guest to login (R3)', () => {
  const loginForm = source('app/[locale]/login/login-form.tsx');
  const registerForm = source('app/[locale]/register/register-form.tsx');

  // 归一的唯一真相在 lib/auth/phone:注册端落库前归一,登录端精确匹配查询,
  // 两端不共用就会「注册得了、登不回」。
  for (const form of [loginForm, registerForm]) {
    assert.match(
      form,
      /import \{ normalizePhoneNumber \} from '@\/lib\/auth\/phone';/,
      'both phone forms must import the shared normalizer',
    );
  }

  // 已注册号误走注册:服务端回 PHONE_ALREADY_REGISTERED,前端出专属面板引导登录
  // (登录会并走游客作品),跳转链接必须继续携带 from(登录后回跳原相册)。
  assert.match(
    registerForm,
    /body\?\.code === 'PHONE_ALREADY_REGISTERED'/,
    'register form must branch on the PHONE_ALREADY_REGISTERED error code',
  );
  assert.match(
    registerForm,
    /loginHref.*phoneAlreadyRegistered|phoneAlreadyRegistered.*loginHref/s,
    'the conflict panel must link to login using the from-preserving loginHref',
  );
});
