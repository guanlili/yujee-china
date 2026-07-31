import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* ════════════════════════════════════════════════════════════════════════════
   移动端「文字被裁切」的守卫。

   真实事故:同一本书,桌面端正常,手机上标题/正文被切掉一截。

   根因是移动端这棵树漏了**两道**桌面与导出都在跑的工序,而不是样式漂移:

     1. loadAlbumFonts —— 中文走 /api/v1/fonts/subset 按需子集,字体要在浏览器里
        动态注册才存在。移动端一次都没调 → 版面里写的 "Noto Serif SC" 等根本没注册,
        整本回退到系统字(PingFang / Songti),字宽字高全变。
     2. fitTextBoxes —— 模板的文字槽是**写死固定高度**的(见 html-templates/*:
        `height:300px` 之类),页根又是 overflow:hidden。装不下时必须按二分把字号收到
        装得下为止;不跑这一步,溢出的部分就被页根**裁掉**。

   桌面在 EditorPort(useAlbumFonts + paintEl 里的 fitTextBoxes)、导出在
   render-raster/single-pages 都跑了这两步,只有移动端两步都没有 —— 所以是移动端独有。
   两步有先后依赖:字体没就绪时量出来的字宽是回退字的,收出来的字号是错的,
   因此字体就绪后必须**重跑一遍** fitTextBoxes。

   用源码断言而不是渲染:仓里无 jsdom,fitTextBoxes 要真实布局(scrollHeight)才有意义。
   这里守住「这两道工序在移动端确实被接上了」。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

test('移动端容器必须加载相册字体子集,否则整本回退系统字、字宽全变', () => {
  const root = read('MobileEditorRoot.tsx');
  assert.match(
    root,
    /useAlbumFonts\(/,
    '移动端漏掉 useAlbumFonts → 中文子集字体从不注册,版面按回退字排,必然溢出',
  );
  assert.match(
    root,
    /from '@\/lib\/font\/album-font-loader'/,
    '字体加载必须用共享的 album-font-loader,不许移动端另写一份',
  );
});

test('移动端两个渲染页面的表面都要跑字号自适应,并让字体到货触发一次重渲', () => {
  for (const file of ['MobileEditor.tsx', 'EditView.tsx']) {
    const src = read(file);
    assert.match(
      src,
      /useFitTextBoxes\(/,
      `${file} 注入了 pageFaceHTML 却不跑字号自适应 —— 装不下的文字会被页根 overflow:hidden 裁掉`,
    );
    assert.match(
      src,
      /data-album-fonts-ready=\{fontsReady\}/,
      `${file} 要把 fontsReady 落到这棵子树上(与桌面 EditorPort/FlipBook 同一个标记) ——` +
        '子集字体到货必须触发一次 commit,字号才会按真字体重收',
    );
  }
});

test('字号自适应每次 commit 都跑,不许绑依赖数组', () => {
  // 这条是本地真机抓出来的:绑了依赖数组时 effect 确实跑过、body 也收到了 16px,
  // 随后一次重渲把 dangerouslySetInnerHTML 的节点整个换掉(字号回到 18px),而依赖没变
  // 所以不再收 —— 最终停在溢出 67px 被裁。桌面 paintEl 是「注入完当场收」,没这个问题。
  const hook = readFileSync(join(here, '../../use-fit-text-boxes.ts'), 'utf8');
  const body = hook.match(/export function useFitTextBoxes\([\s\S]*?\n\}/);
  assert.ok(body, '缺少 useFitTextBoxes');
  assert.match(
    body[0],
    /useLayoutEffect\(\(\) => \{[\s\S]*?\}\);/,
    'fit pass 必须是无依赖数组的 useLayoutEffect(每次 commit 都跑)',
  );
  assert.doesNotMatch(
    body[0].split('useEffect(')[0],
    /\}, \[/,
    'fit pass 一旦绑上依赖数组就会漏掉「重渲换掉节点」那一路,别加回来',
  );
});

test('字号自适应的实现只有一份,且自带「字体到货再收一次」', () => {
  // 移动端那棵树有架构守卫不许出现 document.(见 mobile-editor.test),
  // 而 document.fonts.ready 是必须的 —— 收进共享 hook 后两边都不用让步。
  const hook = readFileSync(join(here, '../../use-fit-text-boxes.ts'), 'utf8');
  assert.match(hook, /fitTextBoxes\(/);
  assert.match(hook, /document\.fonts\?\.ready/, '字体是异步注册的,到货后必须再收一次');
  const fitted = readFileSync(join(here, '../../FittedPageHtml.tsx'), 'utf8');
  assert.match(fitted, /useFitTextBoxes\(/, 'FlipBook/PagePreview 那条也必须用同一份实现');
  for (const file of ['MobileEditor.tsx', 'EditView.tsx']) {
    assert.doesNotMatch(
      read(file),
      /\bdocument\.fonts/,
      '别把这行抄回移动端 —— 那棵树的架构守卫不许出现 document.',
    );
  }
});

test('缩略图条不跑字号自适应(那个尺度看不见,只剩强制重排的开销)', () => {
  // 与 FittedPageHtml 的 fit=false 同一条理由,钉在这里防止「顺手也给 strip 加上」。
  const strip = read('MobileStrip.tsx');
  assert.doesNotMatch(strip, /useFitTextBoxes\(|fitTextBoxes\(/, '缩略图条不该跑字号自适应');
});
