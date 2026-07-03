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
    /authClient\.signIn\.email\(\{ email, password, callbackURL: dest \}\)/,
    'email sign-in must forward callbackURL so verification redirects resume generation',
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
    /authHrefWithFrom\(`\/\$\{locale\}\/login`, from\)/,
    'register form login links must preserve the carried from param',
  );
});
