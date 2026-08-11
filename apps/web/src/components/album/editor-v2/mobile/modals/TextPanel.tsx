'use client';

/* 文字编辑面板(mes 主视图)—— 结构与类名逐条对齐桌面成品(EditorPort 的
   mesTextMainHtml/mesFontListHtml),样式由同一批 .mes-* 规则供给。

   保留那轮已验证有效的移动端交互语言:字号步进胶囊、8 常用色漏出、字体 chips、
   textarea 16px(防 iOS 聚焦缩放,由 .mes-textarea 规则保证)。

   三个视图:main(内容+工具条+颜色+字体) / font(完整字体列表) / color(完整取色器)。 */

import { COLOR_PRESETS } from '@/lib/board-bg/presets';
import { EDITOR_FONTS } from '../../editor-fonts';
import { ColorPicker } from './ColorPicker';
// 面板状态的定义住在 page-edit(改动怎么落到页面上的那一层)—— 面板只是它的一张脸。
import type { TextStyleState } from '../page-edit';
import type { AT } from '@/lib/i18n/pick';

export type { TextStyleState };

export type TextPanelProps = {
  aT: AT;
  view: 'main' | 'font' | 'color';
  state: TextStyleState;
  onChange: (patch: Partial<TextStyleState>) => void;
  onOpenFontList: () => void;
  onBackToMain: () => void;
  /** 完整取色器未做 —— handler 必填,由父层给反馈,不留空 onClick(那就是死按钮)。 */
  onMoreColors: () => void;
};

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
};

const ALIGN_ICONS = {
  left: (
    <svg {...svgProps}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </svg>
  ),
  center: (
    <svg {...svgProps}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="5" y1="18" x2="19" y2="18" />
    </svg>
  ),
  right: (
    <svg {...svgProps}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="6" y1="18" x2="21" y2="18" />
    </svg>
  ),
};

export function TextPanel({
  aT,
  view,
  state,
  onChange,
  onOpenFontList,
  onBackToMain,
  onMoreColors,
}: TextPanelProps) {
  if (view === 'color') {
    return (
      <>
        <button type="button" className="mes-back" onClick={onBackToMain}>
          ‹ {aT('返回', 'Go back')}
        </button>
        <ColorPicker aT={aT} value={state.color} onChange={(css) => onChange({ color: css })} />
      </>
    );
  }

  if (view === 'font') {
    const group = (label: string, script: 'cjk' | 'latin') => {
      const list = EDITOR_FONTS.filter((f) => f.script === script);
      if (!list.length) return null;
      return (
        <div key={script}>
          <div className="mes-font-grp">{label}</div>
          {list.map((f) => (
            <button
              type="button"
              key={f.id}
              className="mes-font-item"
              style={{ fontFamily: f.stack }}
              data-active={state.fontId === f.id ? '1' : undefined}
              onClick={() => {
                onChange({ fontId: f.id });
                onBackToMain();
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      );
    };
    return (
      <>
        <button type="button" className="mes-back" onClick={onBackToMain}>
          ‹ {aT('返回', 'Go back')}
        </button>
        <div className="mes-font-list">
          {group(aT('中文', 'Chinese'), 'cjk')}
          {group(aT('英文', 'Latin'), 'latin')}
        </div>
      </>
    );
  }

  const quickFonts = EDITOR_FONTS.filter((f) => f.script === 'cjk').slice(0, 8);
  const size = state.fontSize;

  return (
    <>
      <textarea
        className="mes-textarea"
        placeholder={aT('输入文字…', 'Enter text…')}
        value={state.text}
        onChange={(e) => onChange({ text: e.target.value })}
      />

      {/* 工具条:字号 / 粗斜 / 对齐 三段独立小胶囊(与桌面 #elBar 同一套) */}
      <div className="mes-tools">
        <div className="mes-tgroup">
          <button
            type="button"
            className="mes-tb mes-tb-step"
            aria-label={aT('减小字号', 'Smaller')}
            onClick={() => onChange({ fontSize: Math.max(6, (size ?? 14) - 1) })}
          >
            −
          </button>
          <input
            className="mes-tb-size"
            inputMode="numeric"
            placeholder="--"
            aria-label={aT('字号', 'Font size')}
            value={size == null ? '' : String(size)}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange({ fontSize: Number.isFinite(n) ? n : null });
            }}
          />
          <button
            type="button"
            className="mes-tb mes-tb-step"
            aria-label={aT('增大字号', 'Larger')}
            onClick={() => onChange({ fontSize: Math.min(200, (size ?? 14) + 1) })}
          >
            +
          </button>
        </div>

        <div className="mes-tgroup">
          <button
            type="button"
            className="mes-tb"
            data-active={state.bold ? '1' : undefined}
            aria-label={aT('加粗', 'Bold')}
            onClick={() => onChange({ bold: !state.bold })}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            className="mes-tb"
            data-active={state.italic ? '1' : undefined}
            aria-label={aT('斜体', 'Italic')}
            onClick={() => onChange({ italic: !state.italic })}
          >
            <i style={{ fontFamily: 'Georgia,serif' }}>I</i>
          </button>
        </div>

        <div className="mes-tgroup">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              type="button"
              key={a}
              className="mes-tb"
              data-active={state.align === a ? '1' : undefined}
              aria-label={aT(
                { left: '左对齐', center: '居中', right: '右对齐' }[a],
                { left: 'Align left', center: 'Center', right: 'Align right' }[a],
              )}
              onClick={() => onChange({ align: a })}
            >
              {ALIGN_ICONS[a]}
            </button>
          ))}
        </div>
      </div>

      {/* 颜色:漏出 8 个常用基础色 + 彩虹「更多」 */}
      <div className="mes-label">{aT('颜色', 'Color')}</div>
      <div className="mes-sw-row">
        {COLOR_PRESETS.slice(0, 8).map((c) => (
          <button
            type="button"
            key={c}
            className={`mes-sw${state.color?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => onChange({ color: c })}
          />
        ))}
        <button
          type="button"
          className="mes-sw mes-sw-more"
          aria-label={aT('更多颜色', 'More colors')}
          onClick={onMoreColors}
        />
      </div>

      {/* 字体:漏出常用中文字体 chips + 「更多」进完整列表 */}
      <div className="mes-label">{aT('字体', 'Font')}</div>
      <div className="mes-fontchip-row">
        {quickFonts.map((f) => (
          <button
            type="button"
            key={f.id}
            className={`mes-fontchip${state.fontId === f.id ? ' active' : ''}`}
            style={{ fontFamily: f.stack }}
            onClick={() => onChange({ fontId: f.id })}
          >
            {f.name}
          </button>
        ))}
        <button
          type="button"
          className="mes-fontchip mes-fontchip-more"
          onClick={onOpenFontList}
        >
          {aT('更多', 'More')}
        </button>
      </div>
    </>
  );
}
