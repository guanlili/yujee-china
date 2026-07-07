import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(join(process.cwd(), 'scripts', 'seed.ts'), 'utf8');
const envSource = readFileSync(join(process.cwd(), 'src', 'lib', 'env.ts'), 'utf8');

test('demo seed creates a real better-auth credential account', () => {
  assert.match(envSource, /DEMO_USER_PASSWORD/, 'demo seed password should be configurable');
  assert.match(source, /hashPassword/, 'seed should use better-auth password hashing');
  assert.match(source, /emailVerified:\s*true/, 'seeded demo user should not require email verification');
  assert.match(source, /providerId:\s*'credential'/, 'seed should create the email-password provider account');
  assert.match(source, /accountId:\s*user\.id/, 'credential account id should match better-auth sign-up behavior');
  assert.match(source, /password:\s*passwordHash/, 'credential account should store the generated password hash');
});
