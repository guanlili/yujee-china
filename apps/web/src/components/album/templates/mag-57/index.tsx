import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-57(#303 第四个真跨页模板):来源 Figma A4-27(fileKey 5uKJQlCURRrrCBU1pd1QT6 /
// node 33:65,1190×842 ×1.3344)。版面:右页整幅大图(image1,Figma 33:66),左页放大
// 标题(title,34:74)+ 一大段正文(body,34:77),底部一行小标签(label,36:79)横跨中缝。
// 画布 1588×1123(双宽),中缝在 x=794:图槽左缘正贴中缝(left:794),填满右页。
//
// 条形码字体降级(已确认):原稿 label 用 Libre Barcode 39 Text 条形码字体渲文字，
// 字体目录里没有这个字体(font-catalog.ts 查证过)。不装/不内联该字体，也不做矢量
// furniture —— label 按普通 decoration 文字槽渲染，走 resolveThemeCarrier 用装饰
// 主题字体(role: decoration，variableDecor)，这是已知、可接受的降级。
//
// body 非 variableDecor(契约只允许 title/decoration 挂 variableDecor)，但仍照
// mag-56/p01 的做法走 resolveThemeCarrier 取色，兜底赤陶色 #b23a2e。三个文字槽都给
// 显式 height + overflow:hidden，让 fitTextBoxes 自动缩字生效。
const BOX = pageBox('mag-57');
const INK = '#b23a2e';

export function WebMag57({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-57', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-57', 'body'));
  const labelTheme = resolveThemeCarrier(data, 'label', contractRole('mag-57', 'label'));

  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 右页整幅大图（槽 image1 = Figma 33:66），左缘正贴中缝，填满右页 */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 794, top: 0, width: 794, height: 1123, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />

      {/* 大标题（槽 title = Figma 34:74 "When He Comes, I Lose"），左页，
          role title + variableDecor：色/字走主题刷，ExtraBold */}
      <div
        data-text-key="title"
        style={{
          position: 'absolute',
          left: 80,
          top: 197,
          width: 494,
          height: 111,
          overflow: 'hidden',
          fontFamily: titleTheme.webFontFamily,
          fontSize: 43,
          fontWeight: 800,
          lineHeight: 1.1,
          color: titleTheme.accentColor ?? INK,
        }}
      >
        {d['title']}
      </div>

      {/* 长正文（槽 body = Figma 34:77），左页，role body，非 variableDecor
          但同样走 resolveThemeCarrier 取色，含空行分段（whiteSpace:pre-wrap） */}
      <div
        data-text-key="body"
        style={{
          position: 'absolute',
          left: 77,
          top: 490,
          width: 618,
          height: 510,
          overflow: 'hidden',
          fontFamily: bodyTheme.webFontFamily,
          fontSize: 21,
          lineHeight: 1.5,
          color: bodyTheme.accentColor ?? INK,
          whiteSpace: 'pre-wrap',
        }}
      >
        {d['body']}
      </div>

      {/* 底部小标签（槽 label = Figma 36:79 "A RECORD OF LOSING · 2026"），左对齐，
          role decoration + variableDecor，lang en。原稿是条形码字体(Libre Barcode
          39 Text)，字体目录里没有 —— 降级为普通装饰文字槽，走主题装饰字体渲染 */}
      <div
        data-text-key="label"
        style={{
          position: 'absolute',
          left: 443,
          top: 999,
          width: 488,
          height: 29,
          overflow: 'hidden',
          fontFamily: labelTheme.webFontFamily,
          fontSize: 21,
          lineHeight: 1.5,
          color: labelTheme.accentColor ?? INK,
        }}
      >
        {d['label']}
      </div>
    </div>
  );
}
