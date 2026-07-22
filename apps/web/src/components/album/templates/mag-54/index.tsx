import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-54(#303 首个跨页模板):通栏满版大图横穿中缝,左半页下方压一行大标题。
// 画布 1588×1123(双宽,PAGE.width*2)。中缝落在 x=794 —— 装订会吃掉中缝附近一点,
// 别把关键信息放进 x∈[750,840];本版式标题在 x=96 起,安全。
const BOX = pageBox('mag-54');
const PAPER = '#f7f4ec';

export function WebMag54({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const title = d['title'] || '';
  // 槽 title 是 variableDecor,颜色/字体由主题刷;role 从契约查,不写死。
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-54', 'title'));
  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 通栏满版大图（槽 image1），横穿中缝 */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 0, top: 0, width: BOX.width, height: BOX.height, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      {/* 左半页压标题（槽 title，variableDecor） */}
      <div
        data-text-key="title"
        style={{
          position: 'absolute', left: 96, bottom: 104, width: 560,
          fontFamily: titleTheme.webFontFamily,
          fontSize: 56, lineHeight: 1.28, letterSpacing: '0.04em',
          color: titleTheme.accentColor ?? PAPER,
          textShadow: '0 2px 24px rgba(0,0,0,.45)',
        }}
      >
        {title}
      </div>
    </div>
  );
}
