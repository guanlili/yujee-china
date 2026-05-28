import { COLORS, WEB_FONTS } from '../constants';
import { WebFolio, WebImage, WebPage } from '../web-utils';
import type { TemplateRenderProps } from '../types';

export function WebMag17({ data, totalPages }: TemplateRenderProps) {
  const d = data as {
    image?: string;
    name1?: string;
    name2?: string;
    folio?: string;
  };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', top: 175, left: 70, right: 70, height: 680 }}
      />
      <h1
        style={{
          position: 'absolute',
          bottom: 105,
          left: 70,
          right: 70,
          margin: 0,
          textAlign: 'center',
          fontFamily: WEB_FONTS.serifEn,
          fontWeight: 400,
          fontSize: 26,
          letterSpacing: '0.36em',
          lineHeight: 1.2,
        }}
      >
        {d.name1 || 'HELENA CHANG'}
        <br />
        <span style={{ fontStyle: 'italic', letterSpacing: '0.20em', fontSize: 22 }}>&amp;</span>{' '}
        {d.name2 || 'KENJI OKABE'}
      </h1>
      <WebFolio folio={d.folio} totalPages={totalPages} fallback="17" />
    </WebPage>
  );
}
