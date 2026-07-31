import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   移动端导出不许给压缩包。

   规则本身不新 —— export-download-wiring.test 早就写着「不要用 zip 绕开限制:让用户
   多解一次压缩包是把技术限制转嫁给用户」。但那条只钉住了 Live 那一条路径,多文件导出
   (单页 JPG / 拼图)后来又把 zip 捡了回来当兜底,于是手机上导出照片拿到的是个
   .zip —— 相册存不进、看不了,等于没导出。

   两条约束同时成立,所以「去掉 zip」不能简单改成逐个自动下载:
     · 不给压缩包(本文件)
     · 兜底不许连发多个自动下载(export-download-wiring.test)—— 连续自动下载会让站点
       进 Chrome 黑名单,之后**静默**丢弃;手机上也常常只落最后一张。

   同时满足两条的解法:系统分享面板仍是主路径(它本来就收多文件、直接进相册);
   分享走不通时不打包、也不自动连发,而是把文件列出来,**每点一次存一张** ——
   每次下载都由一记真实点击触发,既没有压缩包,也不会被静默拦截。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const src = {
  hook: read('use-export.ts'),
  root: read('MobileEditorRoot.tsx'),
  modals: read('modals/ExportModals.tsx'),
  delivery: readFileSync(join(here, '../../../../lib/export/mobile-delivery.ts'), 'utf8'),
  download: readFileSync(join(here, '../../../../lib/export/download.ts'), 'utf8'),
};

test('移动端导出的任何一条路径都不产出 zip', () => {
  for (const [name, text] of Object.entries(src)) {
    assert.doesNotMatch(
      text,
      /createZipBlob|application\/zip|\.zip/,
      `${name} 仍会给用户一个压缩包 —— 手机上存不进相册,等于没导出`,
    );
  }
});

test('打包器本身也删掉,不留着让人再捡回来', () => {
  assert.doesNotMatch(
    src.download,
    /export async function createZipBlob/,
    '唯一调用方已去掉;留着这把枪只会被再次捡起来',
  );
});

test('分享走不通时进入「逐张保存」,而不是打包或连发自动下载', () => {
  assert.match(
    src.delivery,
    /'manual'/,
    '分享不可用且不止一个文件时,要回一个明确的「改成逐张手动保存」结果',
  );
  assert.match(
    src.delivery,
    /export function saveExportFileAt\(/,
    '逐张保存的动作要住在共享交付层,与 deliverMobileExportAssets 同一处',
  );
  assert.match(src.hook, /saveExportFile/, 'hook 必须把逐张保存暴露给弹窗');
  assert.match(src.modals, /onSaveFile/, '弹窗要有逐张保存的入口');
  assert.match(src.root, /onSaveFile=\{/, '入口必须真的接上,不能是死按钮');
});

test('逐张保存的每一次下载都由一记真实点击触发,不在渲染结束后自动连发', () => {
  // click-wiring.test 已禁止 hook 里出现 downloadBlob(;这里补钉共享层:
  // saveExportFileAt 一次只下一个,不循环。
  const m = src.delivery.match(/export function saveExportFileAt\([\s\S]*?\n\}/);
  assert.ok(m, '缺少 saveExportFileAt');
  const body = m[0];
  assert.equal(
    (body.match(/downloadBlob\(/g) ?? []).length,
    1,
    '一次点击只能落一个文件',
  );
  assert.doesNotMatch(body, /for\s*\(|\.forEach\(|\.map\(/, '不许在一次点击里遍历下载');
});
