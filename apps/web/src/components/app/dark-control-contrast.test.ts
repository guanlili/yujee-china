import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..');

const DARK_CONTROL_FILES = [
  'components/app/Sidebar.tsx',
  'components/app/UserMenu.tsx',
  'app/[locale]/create/page.tsx',
  'app/[locale]/login/login-form.tsx',
  'app/[locale]/register/register-form.tsx',
];

function source(file: string): string {
  return readFileSync(join(root, file), 'utf8');
}

test('dark floating controls use explicit white text instead of surface tokens', () => {
  for (const file of DARK_CONTROL_FILES) {
    const content = source(file);
    const darkControlClasses = content.match(/className="[^"]*bg-\[var\(--fg\)\][^"]*"/g) ?? [];
    for (const className of darkControlClasses) {
      assert.doesNotMatch(
        className,
        /text-\[var\(--surface\)\]/,
        `${file} uses a surface token on a dark control: ${className}`,
      );
    }
  }

  assert.match(
    source('components/app/Sidebar.tsx'),
    /bg-\[var\(--fg\)\][^"]*text-white/,
    'sidebar hover tooltip should keep white text on the dark pill',
  );
});
