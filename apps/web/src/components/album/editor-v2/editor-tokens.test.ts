import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/* 移动端与桌面端是两棵独立的 UI 树,但**设计系统只能有一份**:配色/圆角/阴影/
   字体/动效必须同源,否则移动端会慢慢长成另一个产品。

   editor-tokens.css 是那份共享 token(两棵树都引);editor-port.css 保留自己那段
   原始声明(不动它 = 桌面零风险)。这条测试盯住两处不许漂移 —— 改了一边忘了另一边,
   这里会红。 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

/** 从一段 CSS 里抽出 `--name: value;` 对。 */
function tokensOf(css: string, blockStartMarker: string): Map<string, string> {
  const start = css.indexOf(blockStartMarker);
  assert.ok(start >= 0, `没找到 token 块起点: ${blockStartMarker}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    // 只压格式噪音(多余空白、逗号后空格),值本身逐字比 —— #13B8A6 改成别的色才算漂移。
    out.set(m[1], m[2].replace(/\s+/g, ' ').replace(/,\s+/g, ',').trim());
  }
  return out;
}

test('共享 token 与桌面 editor-port 的原始声明逐条一致(值不许漂移)', () => {
  const shared = tokensOf(read('editor-tokens.css'), '.editor-port,');
  const desktop = tokensOf(read('editor-port.css'), '.editor-port{');

  assert.ok(shared.size >= 20, `共享 token 数量异常: ${shared.size}`);

  for (const [name, desktopValue] of desktop) {
    const sharedValue = shared.get(name);
    assert.ok(sharedValue !== undefined, `共享 token 缺了 ${name}(桌面有,移动端拿不到)`);
    assert.equal(
      sharedValue,
      desktopValue,
      `${name} 两处不一致 —— 移动端会长成另一套视觉`,
    );
  }
});

test('移动端样式不自造颜色:除既有 danger 红外,一律走 token 变量', () => {
  let css = read('mobile/mobile-editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // 取色器(.mcp-*)整体豁免:色相条按定义就是**全色谱**,SV 方块的白/黑蒙版也是取色
  // 数学的一部分 —— 它们不是「产品配色」,是被选取的颜色空间本身,没法用 token 表达。
  // 豁免只限这几条规则,别的地方照旧不许出现硬编码色。
  css = css.replace(/\.mobile-modal-host \.mcp[^{]*\{[^}]*\}/g, '');
  const hexes = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
  // #c44 是桌面 .eb-btn.danger 的同一支红(删除格),显式放行;其余硬编码色都算违规。
  const offenders = hexes.filter((h) => h !== '#c44');
  assert.deepEqual(
    offenders,
    [],
    `移动端样式出现了自造颜色: ${offenders.join(', ')} —— 配色必须取自 editor-tokens`,
  );
});
