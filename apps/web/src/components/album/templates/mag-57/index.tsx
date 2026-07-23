import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-57(#303 第四个真跨页模板):来源 Figma A4-27(fileKey 5uKJQlCURRrrCBU1pd1QT6 /
// node 33:65,1190×842 ×1.3344)。版面:右页整幅大图(image1,Figma 33:66),左页放大
// 标题(title,34:74)+ 一大段正文(body,34:77),底部一个条形码(barcode,36:79)。
// 画布 1588×1123(双宽),中缝在 x=794:图槽左缘正贴中缝(left:794),填满右页。
//
// 条形码(Figma 36:79 原用 Libre Barcode 39 Text 字体渲文字;字体目录里没有该字体)
// 改为内联 Code 39 矢量 furniture(bars + 下方可读文字 "A RECORD OF LOSING · 2026",
// 赤陶色 #b23a2e),非文字槽、不可填,与 React/HTML 两侧逐字一致。摆在左页(left:443,
// 不越中缝),按 SVG 自身宽高比缩放。
//
// body 非 variableDecor(契约只允许 title/decoration 挂 variableDecor),但仍照
// mag-56/p01 的做法走 resolveThemeCarrier 取色,兜底赤陶色 #b23a2e。两个文字槽都给
// 显式 height + overflow:hidden,让 fitTextBoxes 自动缩字生效。
const BOX = pageBox('mag-57');
const INK = '#b23a2e';

// Code 39 条形码矢量(furniture,非文字槽)。编码 "A RECORD OF LOSING 2026",
// 下方可读文字保留 "·"。125 根条,viewBox 506.1×33.5,按容器宽度等比缩放。
const BARCODE_SVG =
  `<svg viewBox="0 0 506.1 33.5" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block" preserveAspectRatio="xMinYMid meet" role="img" aria-label="A RECORD OF LOSING · 2026"><rect x="0.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="4.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="7.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="12.6" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="17.5" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="20.3" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="25.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="28.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="32.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="35.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="40.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="45.5" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="50.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="53.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="58.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="60.9" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="65.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="68.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="71.4" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="78.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="81.2" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="86.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="88.9" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="95.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="98.7" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="101.5" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="106.4" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="111.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="116.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="119.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="121.8" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="126.7" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="129.5" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="134.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="139.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="142.1" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="147.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="149.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="152.6" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="159.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="162.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="165.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="168.0" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="175.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="177.8" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="182.7" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="187.6" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="192.5" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="195.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="200.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="203.0" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="207.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="210.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="215.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="220.5" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="223.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="226.1" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="231.0" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="238.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="240.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="243.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="248.5" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="253.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="256.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="261.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="263.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="266.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="271.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="274.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="279.3" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="284.2" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="289.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="291.9" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="296.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="301.7" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="304.5" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="307.3" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="312.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="315.0" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="322.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="324.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="327.6" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="332.5" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="337.4" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="342.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="345.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="347.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="350.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="355.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="360.5" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="365.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="368.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="371.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="375.9" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="380.8" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="385.7" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="390.6" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="395.5" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="398.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="403.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="406.0" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="408.8" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="415.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="418.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="421.4" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="426.3" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="429.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="434.0" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="438.9" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="443.8" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="446.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="449.4" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="456.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="459.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="462.0" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="466.9" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="469.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="476.7" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="481.6" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="484.4" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="487.2" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="492.1" y="0" width="1.4" height="22.0" fill="#b23a2e"/><rect x="494.9" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="499.8" y="0" width="3.5" height="22.0" fill="#b23a2e"/><rect x="504.7" y="0" width="1.4" height="22.0" fill="#b23a2e"/><text x="253.1" y="31.5" text-anchor="middle" font-family="'Inter','Helvetica Neue',sans-serif" font-size="8.5" letter-spacing="1.6" fill="#b23a2e">A RECORD OF LOSING · 2026</text></svg>`;

export function WebMag57({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-57', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-57', 'body'));

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

      {/* 底部条形码（Figma 36:79，Code 39 矢量 furniture，非文字槽），左页不越中缝 */}
      <div
        aria-hidden
        style={{ position: 'absolute', left: 443, top: 1000, width: 345, height: 23, overflow: 'hidden' }}
        dangerouslySetInnerHTML={{ __html: BARCODE_SVG }}
      />
    </div>
  );
}
