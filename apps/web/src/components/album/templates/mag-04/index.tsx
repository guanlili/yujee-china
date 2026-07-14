import { COLORS, WEB_FONTS } from '../constants';
import {WebImage, WebPage} from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag04({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as {
    image1?: string;
    image2?: string;
    explain?: string;
    body?: string;
    title?: string;
  };
  const dateTheme = resolveThemeCarrier(data, 'title', contractRole('mag-04', 'title'));
  const explain1Theme = resolveThemeCarrier(data, 'explain', contractRole('mag-04', 'explain'));
  const explain2Theme = resolveThemeCarrier(data, 'body', contractRole('mag-04', 'body'));
  const dn = (dateTheme.text ?? d.title ?? '04/24').split('/');
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image1}
        placeholder="1:1"
        style={{ position: 'absolute', top: 60, left: 50, width: 380, height: 360 }}
        position={imagePos?.['image1']}
        slotId="image1"
      />
      {/* 展示主元素：大号日期数字（Bebas Neue，高瘦大写展示字） */}
      <div
        style={{
          position: 'absolute',
          top: 150,
          left: 424,
          width: 320,
          height: 120,
          fontFamily: dateTheme.webFontFamily,
          fontSize: 108,
          lineHeight: 1,
          color: dateTheme.accentColor ?? COLORS.ink,
          letterSpacing: '0.04em',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {dn[0]}
        <span style={{ color: dateTheme.accentColor ?? COLORS.ink3, marginLeft: '0.35em' }}>/{dn[1]}</span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 500,
          left: 60,
          width: 347,
          fontFamily: explain1Theme.webFontFamily,
          lineHeight: 1.75,
          color: explain1Theme.accentColor ?? COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 18,
        }}
      >
        {d.explain || ''}
      </div>
      <WebImage
        src={d.image2}
        placeholder="1:1"
        style={{ position: 'absolute', top: 460, right: 50, width: 280, height: 580 }}
        position={imagePos?.['image2']}
        slotId="image2"
      />
      {/* body 左侧加粗竖线，上下与两行文字对齐（18×1.75×2 ≈ 63px） */}
      <div
        style={{
          position: 'absolute',
          top: 760,
          left: 48,
          width: 4,
          height: 63,
          backgroundColor: COLORS.ink2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 760,
          left: 60,
          width: 347,
          fontFamily: explain2Theme.webFontFamily,
          lineHeight: 1.75,
          color: explain2Theme.accentColor ?? COLORS.ink2,
          textAlign: 'justify',
          letterSpacing: '0.02em',
          fontSize: 18,
        }}
      >
        {d.body || ''}
      </div></WebPage>
  );
}
