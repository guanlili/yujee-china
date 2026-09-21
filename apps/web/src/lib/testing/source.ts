import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web/src — every path below is relative to it. */
const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The file as written, comments included. Only for assertions ABOUT comments. */
export function readSource(path: string): string {
  return readFileSync(join(WEB_SRC, path), 'utf8');
}

/**
 * Block comments (a JSX comment is one, wrapped in braces) and whole-line `//`
 * comments removed. Trailing `//` is left alone on purpose: a URL carries one.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Source with comments removed — what a source-regex test must read.
 *
 * A test that greps the raw file is satisfied by a comment. This repo learned
 * that the hard way: a wiring guard stayed green while the wiring it pinned
 * sat inside a `//`. Every positive assertion on a source file goes through
 * this, so commenting the code out fails the test the way deleting it does.
 */
export function readCode(path: string): string {
  return stripComments(readSource(path));
}
