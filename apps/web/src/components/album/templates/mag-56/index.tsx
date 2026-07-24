import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-56(#303 第三个真跨页模板):来源 Figma A4-26(fileKey 5uKJQlCURRrrCBU1pd1QT6 /
// node 28:56,1190×842 ×1.3344)。版面极简:一张近满幅大图(image1,Figma 28:59)故意
// 跨中缝(spans x∈[63,1524]),左下一段收尾正文(body,Figma 28:63,role: body)。
// 画布 1588×1123(双宽),中缝在 x=794。body 非 variableDecor(契约只允许 title/decoration
// 挂 variableDecor),但仍照 p01 的 body 做法走 resolveThemeCarrier 拿字体/颜色,兜底赤陶色
// #b23a2e;body 给显式 height 140 + overflow:hidden,让 fitTextBoxes 自动缩字生效,停在
// x=745,不进中缝附近 x∈[750,840],留在左页。
const BOX = pageBox('mag-56');
const BODY_INK = '#b23a2e';

export function WebMag56({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const bodyTheme = resolveThemeCarrier(data, 'body', contractRole('mag-56', 'body'));

  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 满幅大图（槽 image1 = Figma 28:59），故意跨中缝：spans x∈[63,1524] */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 63, top: 72, width: 1461, height: 839, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />

      {/* 收尾正文（槽 body，Figma 28:63，role: body，非 variableDecor 但走主题刷），
          左页：停在 x=745，不进中缝附近 x∈[750,840] */}
      <div
        data-text-key="body"
        style={{
          position: 'absolute',
          left: 63,
          top: 955,
          width: 682,
          height: 140,
          overflow: 'hidden',
          fontFamily: bodyTheme.webFontFamily,
          fontSize: 21,
          lineHeight: 1.5,
          color: bodyTheme.accentColor ?? BODY_INK,
          whiteSpace: 'pre-wrap',
        }}
      >
        {d['body']}
      </div>
    </div>
  );
}
