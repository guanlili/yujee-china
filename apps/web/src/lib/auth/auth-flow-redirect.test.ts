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

test('phone password reset is a same-page flow; email reset keeps its link', () => {
  const loginForm = source('app/[locale]/login/login-form.tsx');
  const forgotForm = source('app/[locale]/forgot-password/forgot-password-form.tsx');
  const forgotPage = source('app/[locale]/forgot-password/page.tsx');
  const resetForm = source('app/[locale]/reset-password/reset-password-form.tsx');

  const phoneBlock = loginForm.split("mode === 'phone'")[1]?.split("mode === 'email'")[0] ?? '';
  const emailBlock = loginForm.split("mode === 'email'")[1] ?? '';
  assert.match(phoneBlock, /forgot-password\?mode=phone/, 'phone login must link to the phone reset tab');
  assert.match(phoneBlock, /messages\.forgotPassword/);
  assert.match(emailBlock, /forgot-password\?mode=email/, 'email login must keep the email reset tab');

  assert.match(forgotPage, /mode === 'email' \? 'email' : 'phone'/, 'forgot-password defaults to phone');
  assert.match(forgotForm, /normalizePhoneNumber\(phone\)/);
  assert.match(forgotForm, /authClient\.phoneNumber\.requestPasswordReset\(\{\s*phoneNumber: target,\s*\}\)/);
  assert.match(
    forgotForm,
    /authClient\.phoneNumber\.resetPassword\(\{\s*phoneNumber: normalizedPhone,\s*otp: otp\.trim\(\),\s*newPassword: password,\s*\}\)/,
  );
  assert.match(forgotForm, /error\.status === 429/);
  assert.match(forgotForm, /messages\.forgotPasswordPhoneRateLimit/);
  assert.match(forgotForm, /messages\.forgotPasswordPhoneCodeBody/);
  // 邮件找回仍是同一页上的 requestPasswordReset → /reset-password?token= 链接流。
  assert.match(forgotForm, /authClient\.requestPasswordReset\(\{\s*email,\s*redirectTo: `\/\$\{locale\}\/reset-password`,\s*\}\)/);
  assert.match(resetForm, /authClient\.resetPassword\(\{\s*newPassword: password,\s*token,\s*\}\)/);
  assert.match(resetForm, /forgot-password\?mode=email/);

  const required = [
    'forgotPasswordPhoneSubtitle',
    'forgotPasswordPhoneAction',
    'forgotPasswordPhoneCodeTitle',
    'forgotPasswordPhoneCodeBody',
    'forgotPasswordPhoneOtp',
    'forgotPasswordPhoneResend',
    'forgotPasswordPhoneResent',
    'forgotPasswordPhoneInvalid',
    'forgotPasswordPhoneOtpError',
    'forgotPasswordPhoneError',
    'forgotPasswordPhoneRateLimit',
    'resetPasswordTooLong',
  ];
  for (const locale of ['en', 'zh', 'ja', 'fr', 'es']) {
    const auth = JSON.parse(readFileSync(join(srcRoot, 'messages', `${locale}.json`), 'utf8')).auth as Record<string, string>;
    for (const key of required) {
      assert.equal(typeof auth[key], 'string', `${locale}.json auth.${key} must be set`);
      assert.doesNotMatch(auth[key], /capture/i, `${locale}.json auth.${key} must not mention capture`);
    }
  }
  const zh = JSON.parse(readFileSync(join(srcRoot, 'messages', 'zh.json'), 'utf8')).auth as Record<string, string>;
  assert.match(zh.forgotPasswordPhoneCodeBody, /若账号存在将收到验证码/);
  assert.match(zh.forgotPasswordPhoneSubtitle, /若账号存在/);
});

test('login page offers no Google entry (China build: email + phone only)', () => {
  const loginForm = source('app/[locale]/login/login-form.tsx');
  const loginPage = source('app/[locale]/login/page.tsx');

  // 2026-10-27 起国内版移除 Google 登录:按钮、文案键、signIn.social('google')
  // 都不应回潮。存量 accounts 行保留,Apple 维持「配了才显示」不变。
  for (const src of [loginForm, loginPage]) {
    assert.doesNotMatch(
      src,
      /GoogleIcon|continueWithGoogle|googleError|provider:\s*'google'/,
      'Google login entry must not come back on the login page',
    );
  }

  // 五个 locale 的 auth 段不再携带 Google 键(en.json 是 AppMessages 的类型源,
  // 键回来了登录页就会拿到未定义引用;其余 locale 留着就是死文案)。
  for (const locale of ['en', 'zh', 'ja', 'fr', 'es']) {
    const messages = JSON.parse(
      readFileSync(join(srcRoot, 'messages', `${locale}.json`), 'utf8'),
    );
    assert.ok(
      !('continueWithGoogle' in messages.auth) && !('googleError' in messages.auth),
      `${locale}.json still carries Google auth copy`,
    );
  }
});
