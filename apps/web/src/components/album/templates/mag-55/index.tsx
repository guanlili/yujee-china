import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-55(#303 第二个真跨页模板):来源 Figma A4-7 通栏跨页(fileKey 5uKJQlCURRrrCBU1pd1QT6 /
// node 11:271,1190×842 ×1.3344)。mag-52/53 是这同一张 Figma 当年被手工拆成的左右两张假跨页
// A4;mag-52 组件里那段手写矢量 furniture(node 11:331)在 Figma 里已被替换成可编辑文字节点
// 28:55 "the slow afternoon" —— 这里按现状还原成一个真文字槽(label,role: decoration),不
// 内联那段 HANDWRITING_SVG。画布 1588×1123(双宽),中缝在 x=794:大图(image3)与大标题
// (title)按 Figma 原坐标故意跨中缝渲染,这正是跨页的意义。
const BOX = pageBox('mag-55');
const LABEL_INK = '#111';
const TITLE_INK = '#262626';

export function WebMag55({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  // 两个 variableDecor 槽的色/字走主题刷,role 从契约查,不写死。
  const labelTheme = resolveThemeCarrier(data, 'label', contractRole('mag-55', 'label'));
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-55', 'title'));

  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 左上小图 1（槽 image1 = Figma 11:273） */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 0, top: 0, width: 240, height: 260, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />

      {/* 左上小图 2（槽 image2 = Figma 11:274） */}
      <WebImage
        src={d['image2']}
        style={{ position: 'absolute', left: 251, top: 0, width: 240, height: 260, objectFit: 'cover' }}
        position={imagePos?.['image2']}
        slotId="image2"
      />

      {/* 右侧大图（槽 image3 = Figma 11:311），故意跨中缝：spans x∈[614,1521] */}
      <WebImage
        src={d['image3']}
        style={{ position: 'absolute', left: 614, top: 61, width: 907, height: 1001, objectFit: 'cover' }}
        position={imagePos?.['image3']}
        slotId="image3"
      />

      {/* 手写体副标题（槽 label，Figma 28:55 "the slow afternoon"，role: decoration，
          variableDecor：色/字走主题刷），左页 */}
      <div
        data-text-key="label"
        style={{
          position: 'absolute',
          left: 140,
          top: 295,
          width: 474,
          height: 107,
          fontFamily: labelTheme.webFontFamily,
          fontSize: 80,
          lineHeight: 1.1,
          color: labelTheme.accentColor ?? LABEL_INK,
          overflow: 'hidden',
        }}
      >
        {d['label']}
      </div>

      {/* 大标题（槽 title = Figma 11:327 "Notes from Elsewhere"），故意跨中缝：
          spans x∈[491,1237]，压在大图上层，必须最后渲染才可见 */}
      <div
        data-text-key="title"
        style={{
          position: 'absolute',
          left: 491,
          top: 833,
          width: 746,
          height: 207,
          fontFamily: titleTheme.webFontFamily,
          fontSize: 93,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          color: titleTheme.accentColor ?? TITLE_INK,
          overflow: 'hidden',
        }}
      >
        {d['title']}
      </div>
    </div>
  );
}
