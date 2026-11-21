import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const { CJK_FONT_IDS, CJK_FONT_MANIFEST, isCjkFontId } = await import('./font-manifest');

// 字体的 web 侧已收敛到单一源 apps/web/chapters-source/fonts/(PR #401),但 PDF
// 子集化走的是 font-service 里的 FONTS_DIR = <apps/web>/fonts —— 那份清单的
// `file` 相对 `apps/web/fonts` 解析(art/ 子目录下是艺术字体)。所以这里校验
// 的是 PDF 字体那一份,不是 chapters-source。
const FONT_DIR_CANDIDATES = [
  path.resolve(process.cwd(), 'fonts'),
  path.resolve(process.cwd(), 'apps/web/fonts'),
];

test('CJK_FONT_IDS 与 manifest 的键集合双向一致', () => {
  const ids = [...CJK_FONT_IDS];
  const keys = Object.keys(CJK_FONT_MANIFEST);
  assert.equal(new Set(ids).size, ids.length, 'CJK_FONT_IDS 不应有重复项');
  assert.deepEqual(new Set(keys), new Set(ids), 'manifest 的键必须与 CJK_FONT_IDS 完全对应');
});

test('每条清单都补齐 webFamily / pdfFamily / file 且非空', () => {
  for (const id of CJK_FONT_IDS) {
    const entry = CJK_FONT_MANIFEST[id];
    assert.ok(entry, `${id} 缺清单条目`);
    for (const field of ['webFamily', 'pdfFamily', 'file'] as const) {
      assert.equal(typeof entry[field], 'string', `${id}.${field} 必须是字符串`);
      assert.ok(entry[field].trim().length > 0, `${id}.${field} 不能为空`);
    }
    assert.match(entry.file, /\.(ttf|otf|woff2?)$/, `${id}.file 应是字体文件`);
  }
});

test('文件名不重复：两个字体 ID 不能指向同一个文件', () => {
  const files = CJK_FONT_IDS.map((id) => CJK_FONT_MANIFEST[id].file);
  assert.equal(new Set(files).size, files.length, '存在两个 ID 共用同一字体文件');
});

test('清单里的字体文件在 PDF 字体目录中真实存在', (t) => {
  const dir = FONT_DIR_CANDIDATES.find((d) => existsSync(d));
  if (!dir) {
    // 脱离仓库结构运行时跳过,避免把环境问题当成代码问题。
    return t.skip(`未找到字体目录(试过 ${FONT_DIR_CANDIDATES.join(', ')})`);
  }
  for (const id of CJK_FONT_IDS) {
    const file = CJK_FONT_MANIFEST[id].file;
    const full = path.join(dir, file);
    assert.ok(existsSync(full), `${id} 的 ${file} 不在 ${dir}`);
    assert.ok(readFileSync(full).length > 0, `${id} 的 ${file} 是空文件`);
  }
});

test('isCjkFontId 只对清单内的 ID 返回 true', () => {
  assert.equal(isCjkFontId('noto-serif-sc'), true);
  assert.equal(isCjkFontId('zcool-xiaowei'), true);
  assert.equal(isCjkFontId('noto-serif-tc'), false, '同家族但不在清单内');
  assert.equal(isCjkFontId(''), false);
  // 大小写/空格不宽松：调用方拿到的是模板里的字面值,不做模糊匹配。
  assert.equal(isCjkFontId('Noto-Serif-SC'), false);
});
