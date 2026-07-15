import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 账户菜单统一为 <UserMenu>(与 landing / my-albums 同一组件):此前编辑页是手搓
// 静态 demo(Liam Chen)+ 命令式补真名 + 命令式注入 EN/中文 语言行,三套逻辑打架、
// 语言行还会随画布重挂累积(线上实测两排)。改为 React 组件后由它自管,累积问题
// 从根上消失。这两条断言守住「不许回到手搓 + 命令式注入」。
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

test('编辑页账户菜单用统一的 <UserMenu>,并开启菜单内语言切换', () => {
  assert.match(
    src,
    /<UserMenu\s+user=\{session\.user\}\s+locale=\{locale\}\s+showLangSwitch\s*\/>/,
    '编辑页 topbar 必须渲染 <UserMenu user locale showLangSwitch/>',
  );
  assert.match(src, /useChromeSession\(\)/, '账户数据必须来自 useChromeSession(真实用户)');
});

test('不得回退到手搓 demo 菜单或命令式注入语言行', () => {
  assert.doesNotMatch(src, /Liam Chen|liam@example\.com/, '不许残留 demo 占位账户');
  assert.doesNotMatch(src, /data-lang-row/, '不许命令式注入语言行(改由 UserMenu 渲染)');
  assert.doesNotMatch(src, /dropdown-header-name/, '不许命令式回填姓名(改由 UserMenu 渲染)');
});
