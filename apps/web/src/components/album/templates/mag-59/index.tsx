import type { CSSProperties } from 'react';
import type { TemplateRenderProps } from '../types';
import { pageBox } from '../constants';
import { WebImage } from '../web-utils';
import { resolveThemeCarrier } from '../theme-carrier';
import { contractRole } from '../contract-role';

// mag-59(#303 第六个真跨页模板,本批最复杂):来源 Figma A4-28(fileKey
// 5uKJQlCURRrrCBU1pd1QT6 / node 36:85,1190×842 ×1.3344)。版面:一张近满幅大图
// 打底(image1,36:86,横跨整个跨页),左页大标题「PASSION」(title,36:?)+ 一段
// 说明(caption);右页三张白色人物卡,每张卡 = 一张照片(image2/3/4,36:97/99/101)
// + 名字(name1/2/3,粗体)+ 居中的角色描述(role1/2/3)。画布 1588×1123(双宽),
// 中缝在 x=794。
//
// 只有 image1 横跨中缝(满幅底图,设计意图);三张卡全部在右页(card1 left=883 >
// 794),title/caption 在左页 —— 都不需要担心中缝重叠。z 序:image1(底图)→ 三张
// 白卡 furniture → 三张照片(叠在卡上)→ 每卡的 name/role 文字 → 左页 title/
// caption。
//
// 4 图槽 + 8 文字槽 + 3 张白卡 furniture(纯 div,白底 + 圆角 + 柔和阴影,无
// data-* 锚点 —— 不是槽)。title 是本模板唯一允许 variableDecor 的槽(role
// title);caption/name*/role* 都是 body/explain,契约禁止其上 variableDecor(见
// templates.test.ts),但仍照 mag-58 的做法走 resolveThemeCarrier 取色,兜底赤陶色
// #b23a2e。name/role 居中(Figma 里是 translate-x-1/2 居中),title/caption 左对
// 齐。全部文字槽给显式 height + overflow:hidden,让 fitTextBoxes 自动缩字生效。
const BOX = pageBox('mag-59');
const INK = '#b23a2e';

interface CardSpec {
  card: { left: number; top: number; width: number; height: number };
  photoId: string;
  photo: { left: number; top: number; width: number; height: number };
  nameId: string;
  name: { left: number; top: number; width: number; height: number };
  roleId: string;
  role: { left: number; top: number; width: number; height: number };
}

const CARDS: CardSpec[] = [
  {
    card: { left: 883, top: 515, width: 211, height: 295 },
    photoId: 'image2',
    photo: { left: 895, top: 527, width: 187, height: 132 },
    nameId: 'name1',
    name: { left: 895, top: 671, width: 187, height: 24 },
    roleId: 'role1',
    role: { left: 895, top: 709, width: 187, height: 44 },
  },
  {
    card: { left: 1103, top: 515, width: 212, height: 295 },
    photoId: 'image3',
    photo: { left: 1117, top: 527, width: 187, height: 132 },
    nameId: 'name2',
    name: { left: 1117, top: 671, width: 187, height: 24 },
    roleId: 'role2',
    role: { left: 1117, top: 712, width: 187, height: 44 },
  },
  {
    card: { left: 1325, top: 515, width: 211, height: 295 },
    photoId: 'image4',
    photo: { left: 1337, top: 527, width: 187, height: 132 },
    nameId: 'name3',
    name: { left: 1337, top: 671, width: 187, height: 24 },
    roleId: 'role3',
    role: { left: 1337, top: 709, width: 187, height: 60 },
  },
];

export function WebMag59({ data, imagePos }: TemplateRenderProps) {
  const d = data as Record<string, string>;
  const titleTheme = resolveThemeCarrier(data, 'title', contractRole('mag-59', 'title'));
  const captionTheme = resolveThemeCarrier(data, 'caption', contractRole('mag-59', 'caption'));

  return (
    <div style={{ position: 'relative', width: BOX.width, height: BOX.height, background: '#FFFFFF', overflow: 'hidden' }}>
      {/* 满幅底图（槽 image1 = Figma 36:86），横跨整个跨页 */}
      <WebImage
        src={d['image1']}
        style={{ position: 'absolute', left: 0, top: 59, width: 1588, height: 1005, objectFit: 'cover' }}
        position={imagePos?.['image1']}
        slotId="image1"
      />

      {/* 右页三张白色人物卡：furniture（纯 div，无 data-* 锚点）+ 照片槽 + name/role 文字槽 */}
      {CARDS.map(({ card, photoId, photo, nameId, name, roleId, role }) => {
        const nameTheme = resolveThemeCarrier(data, nameId, contractRole('mag-59', nameId));
        const roleTheme = resolveThemeCarrier(data, roleId, contractRole('mag-59', roleId));
        const centerStyle: CSSProperties = { textAlign: 'center' };
        return (
          <div key={photoId}>
            <div
              style={{
                position: 'absolute',
                left: card.left,
                top: card.top,
                width: card.width,
                height: card.height,
                background: '#fff',
                borderRadius: 2,
                boxShadow: '0 2px 12px rgba(0,0,0,.08)',
              }}
            />
            <WebImage
              src={d[photoId]}
              style={{ position: 'absolute', left: photo.left, top: photo.top, width: photo.width, height: photo.height, objectFit: 'cover' }}
              position={imagePos?.[photoId]}
              slotId={photoId}
            />
            <div
              data-text-key={nameId}
              style={{
                position: 'absolute',
                left: name.left,
                top: name.top,
                width: name.width,
                height: name.height,
                overflow: 'hidden',
                fontFamily: nameTheme.webFontFamily,
                fontSize: 19,
                fontWeight: 700,
                lineHeight: 1.2,
                color: nameTheme.accentColor ?? INK,
                ...centerStyle,
              }}
            >
              {d[nameId]}
            </div>
            <div
              data-text-key={roleId}
              style={{
                position: 'absolute',
                left: role.left,
                top: role.top,
                width: role.width,
                height: role.height,
                overflow: 'hidden',
                fontFamily: roleTheme.webFontFamily,
                fontSize: 16,
                fontWeight: 400,
                lineHeight: 1.3,
                color: roleTheme.accentColor ?? INK,
                ...centerStyle,
              }}
            >
              {d[roleId]}
            </div>
          </div>
        );
      })}

      {/* 左页大标题（槽 title，role title + variableDecor，色/字走主题刷） */}
      <div
        data-text-key="title"
        style={{
          position: 'absolute',
          left: 129,
          top: 272,
          width: 494,
          height: 111,
          overflow: 'hidden',
          fontFamily: titleTheme.webFontFamily,
          fontSize: 85,
          fontWeight: 800,
          lineHeight: 1.1,
          color: titleTheme.accentColor ?? INK,
        }}
      >
        {d['title']}
      </div>

      {/* 左页说明（槽 caption，role body，非 variableDecor，仍走 resolveThemeCarrier 取色） */}
      <div
        data-text-key="caption"
        style={{
          position: 'absolute',
          left: 414,
          top: 562,
          width: 303,
          height: 103,
          overflow: 'hidden',
          fontFamily: captionTheme.webFontFamily,
          fontSize: 19,
          fontWeight: 500,
          lineHeight: 1.4,
          color: captionTheme.accentColor ?? INK,
        }}
      >
        {d['caption']}
      </div>
    </div>
  );
}
