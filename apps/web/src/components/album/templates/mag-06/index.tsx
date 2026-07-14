import { WEB_FONTS } from '../constants';
import {WebImage, WebPage} from '../web-utils';
import type { TemplateRenderProps } from '../types';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

export function WebMag06({ data, totalPages, imagePos }: TemplateRenderProps) {
  const d = data as { image?: string };
  return (
    <WebPage fontFamily={WEB_FONTS.sansEn}>
      <WebImage
        src={d.image}
        placeholder="3:4"
        style={{ position: 'absolute', left: 83, top: 90, width: 628, height: 943 }}
        position={imagePos?.['image']}
        slotId="image"
      /></WebPage>
  );
}
