import type { TemplateRenderProps } from '../types';
import { PAGE, WEB_FONTS } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// 封面 · 椭圆挖空（category: cover，1 图）。深墨绿底；胶囊形（两端全圆）照片框
// 水平居中；主标题 + 副标题压顶居中；右侧竖排系列名（label，旋转 90°）；
// 底部左品牌字（label2）+ 底部右年记（label3）。
//
// 语言口径（#307）：title 的 lang 在 engine 侧 compose handler 里被强制覆盖成
// en（产品决定标题一律英文、走杂志感），explain/label/label2/label3 都照
// mag-62.json 声明的 lang 走 —— explain 这里声明的是 user，不是固定英文；下面
// sample 兜底给的英文串只是示例文案的巧合，不代表这个槽恒定出英文。
// 几何逐一镜像自 HTML 模板真相 `render/html-templates/mag-62.ts`（MAG_62_HTML）：
// 794×1123、绝对定位、写死 px。胶囊 212×402、圆角 106（= 宽的一半，两端全圆）、
// left 291（(794-212)/2，水平居中）、top 366。

const BG = '#12363A';
const INK = '#E7E3D8';
const TITLE_COLOR = '#F0A4C2';

export function WebMag62({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-62', 'title'));
  const explainTheme = resolveThemeCarrier(data, 'explain', contractRole('mag-62', 'explain'));
  const labelTheme = resolveThemeCarrier(data, 'label', contractRole('mag-62', 'label'));
  const label2Theme = resolveThemeCarrier(data, 'label2', contractRole('mag-62', 'label2'));
  const label3Theme = resolveThemeCarrier(data, 'label3', contractRole('mag-62', 'label3'));
  return (
    <div
      style={{
        position: 'relative',
        width: PAGE.width,
        height: PAGE.height,
        background: BG,
        color: INK,
        overflow: 'hidden',
        boxSizing: 'border-box',
        fontFamily: WEB_FONTS.worksans,
      }}
    >
      {/* 主标题（槽 title，居中压顶） */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 118,
          width: 654,
          textAlign: 'center',
          fontFamily: titleTheme.artFont ? titleTheme.webFontFamily : WEB_FONTS.playfair,
          fontSize: 52,
          lineHeight: 1.2,
          letterSpacing: '3px',
          color: titleTheme.accentColor ?? TITLE_COLOR,
        }}
      >
        {d['title'] || '海边那年'}
      </div>

      {/* 副标题（槽 explain，同宽居中；lang:user 随用户书的语言走，见文件头「语言口径」） */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 196,
          width: 654,
          textAlign: 'center',
          fontFamily: explainTheme.artFont ? explainTheme.webFontFamily : WEB_FONTS.playfair,
          fontSize: 22,
          lineHeight: 1.4,
          letterSpacing: '0.6px',
          color: explainTheme.accentColor ?? INK,
        }}
      >
        {d['explain'] || 'The Year We Walked the Shore'}
      </div>

      {/* 胶囊照片框（槽 image，两端全圆、水平居中：212×402、圆角 106、left 291、top 366） */}
      <WebImage
        src={d['image']}
        style={{ position: 'absolute', left: 291, top: 366, width: 212, height: 402, borderRadius: 106, objectFit: 'cover' }}
        position={imagePos?.['image']}
        slotId="image"
      />

      {/* 右侧竖排系列名（槽 label，旋转 90°，贴右缘） */}
      <div
        style={{
          position: 'absolute',
          left: 664,
          top: 400,
          width: 334,
          transform: 'rotate(90deg)',
          transformOrigin: '0 0',
          fontFamily: labelTheme.artFont ? labelTheme.webFontFamily : WEB_FONTS.worksans,
          fontSize: 15,
          letterSpacing: '2.4px',
          color: labelTheme.accentColor ?? INK,
        }}
      >
        {d['label'] || 'Yujee Collection ①'}
      </div>

      {/* 底部左：品牌字（槽 label2） */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          bottom: 78,
          fontFamily: label2Theme.artFont ? label2Theme.webFontFamily : WEB_FONTS.playfair,
          fontSize: 24,
          letterSpacing: '1px',
          color: label2Theme.accentColor ?? INK,
        }}
      >
        {d['label2'] || 'yujee'}
      </div>

      {/* 底部右：年记（槽 label3） */}
      <div
        style={{
          position: 'absolute',
          right: 70,
          bottom: 74,
          textAlign: 'right',
          fontFamily: label3Theme.artFont ? label3Theme.webFontFamily : WEB_FONTS.worksans,
          fontSize: 15,
          lineHeight: 1.7,
          letterSpacing: '1px',
          color: label3Theme.accentColor ?? INK,
        }}
      >
        {d['label3'] || '2026 年记'}
      </div>
    </div>
  );
}
