import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-58(#303 第五个真跨页模板):来源 Figma A4-30(fileKey 5uKJQlCURRrrCBU1pd1QT6 /
// node 37:124,1190×842 ×1.3344)。版面:左页整幅大图(image1,Figma 37:125),一张
// 小图浮在中缝上(image2,37:130,跨中缝),右页放标题(title,37:126)+ 一大段正文
// (body,37:127)。画布 1588×1123(双宽),中缝在 x=794。
//
// image1 填满左页(右缘=794=中缝);image2 故意跨中缝(浮动 inset,设计意图,spans
// x∈[576,1011]);title/body 在右页,均清中缝(title 起于 x=1103,image2 右缘
// x=1011,不重叠)。z 序:image1 → image2 → title → body。
//
// body 非 variableDecor(契约只允许 title/decoration 挂 variableDecor),但仍照
// mag-57/mag-56/p01 的做法走 resolveThemeCarrier 取色,兜底赤陶色 #b23a2e。两个
// 文字槽都给显式 height + overflow:hidden,让 fitTextBoxes 自动缩字生效。
const BOX = pageBox('mag-58');
const INK = '#b23a2e';

export function WebMag58({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-58', 'title'));
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-58', 'body'));

  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左页整幅大图（槽 image1 = Figma 37:125），填满左页，右缘正贴中缝 */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 0, top: 0, width: 794, height: 1123, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />

      {/* 中缝上的浮动小图（槽 image2 = Figma 37:130），故意跨中缝：spans x∈[576,1011] */}
      <WebImage
        src={d['image2']}
        style={{ position: 'absolute', left: 576, top: 340, width: 435, height: 464, objectFit: 'cover' }}
        position={imagePos?.['image2']}
        slotId="image2"
      />

      {/* 标题（槽 title = Figma 37:126 "No Sentence / Stopped Explaining"），右页，
          role title + variableDecor：色/字走主题刷，ExtraBold */}
      <div
        data-text-key="title"
        style={{
          position: 'absolute',
          left: 1103,
          top: 237,
          width: 391,
          height: 103,
          overflow: 'hidden',
          fontFamily: titleTheme.webFontFamily,
          fontSize: 35,
          fontWeight: 800,
          lineHeight: 1.1,
          color: titleTheme.accentColor ?? INK,
        }}
      >
        {d['title']}
      </div>

      {/* 长正文（槽 body = Figma 37:127），右页，role body，非 variableDecor
          但同样走 resolveThemeCarrier 取色，含空行分段（whiteSpace:pre-wrap） */}
      <div
        data-text-key="body"
        style={{
          position: 'absolute',
          left: 1103,
          top: 400,
          width: 391,
          height: 544,
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
    </div>
  );
}
