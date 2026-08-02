import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// #165: WebImage honors an optional per-slot position override.
//   Absent ⇒ objectPosition '50% 50%' (centered cover); present ⇒ `${x}% ${y}%`.
// #168: the slot `style` is now the geometry of a FIXED frame — an
// `overflow:hidden` wrapper <div> — and the image fills that frame 100%×100%.
// A scale>1 zoom is applied to the INNER image and clipped by the wrapper, so it
// can never grow the slot box / push neighboring content.
// (矢量 PDF 侧的对应实现已随 C 方案退役;导出走栅格截屏,天然与 web 渲染一致。)

test('#168 web image: overflow-hidden wrapper, inner img fills 100% with cover', () => {
  const webSource = readFileSync(new URL('./web-utils.tsx', import.meta.url), 'utf8');
  // default branch when no override
  assert.match(
    webSource,
    /const objectPosition = position \? `\$\{position\.x\}% \$\{position\.y\}%` : '50% 50%';/,
  );
  // the caller style (slot geometry) is spread onto a wrapper that clips overflow,
  // after stripping the paint-only objectFit/objectPosition off it
  assert.match(webSource, /const \{ objectFit: _of, objectPosition: _op, \.\.\.frame \} = style;/);
  // 2026-08-02 rotate:wrapper 仍是「frame 展开 + overflow:hidden」,旋转分支只在
  // wrapper 未声明 position 时补 relative(绝对定位 img 的包含块)。
  assert.match(
    webSource,
    /<div\s+style=\{\{\s*\.\.\.frame,\s*overflow: 'hidden',\s*\.\.\.\(rotated && !frame\.position \? \{ position: 'relative' \} : \{\}\),\s*\}\}\s*>/s,
  );
  // inner <img>(未旋转分支)fills the frame and keeps cover + objectPosition + zoom
  assert.match(
    webSource,
    /objectFit: 'cover',\s*objectPosition,/s,
  );
  assert.match(webSource, /\{ width: '100%', height: '100%', \.\.\.zoom \}/, '未旋转分支 100%×100% 原样');
  // scale>1 applies the transform zoom (anchored at focal point) on the INNER img
  assert.match(webSource, /position\.scale > 1/);
  assert.match(webSource, /transform: `scale\(\$\{position\.scale\}\)`/);
  assert.match(webSource, /transformOrigin: `\$\{position\.x\}% \$\{position\.y\}%`/);
  // the editor still locates the slot via data-image-slot on the inner <img>
  assert.match(webSource, /<img[\s\S]*?data-image-slot=\{slotId\}/);
});
