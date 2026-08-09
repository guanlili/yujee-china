'use client';

/* 页面底色面板(mes 的 page 模式)—— 只管**当前这一页的底色**,与画板垫底背景
   是两回事(后者在浏览态左下角,走 BoardBgSheet)。

   类名沿用 .mes-sw / .mes-label,与文字面板的颜色行同一套视觉。 */

import { COLOR_PRESETS } from '@/lib/board-bg/presets';
import { ColorPicker } from './ColorPicker';
import type { AT } from '@/lib/i18n/pick';

export type PageBgPanelProps = {
  aT: AT;
  /** 当前页底色;null = 无背景(透出纸白)。 */
  value: string | null;
  /** 'main' = 色板 + 「更多」;'color' = 完整取色器。 */
  view: 'main' | 'color';
  onChange: (color: string | null) => void;
  onOpenPicker: () => void;
  onBackToMain: () => void;
};

export function PageBgPanel({ aT, value, view, onChange, onOpenPicker, onBackToMain }: PageBgPanelProps) {
  if (view === 'color') {
    return (
      <>
        <button type="button" className="mes-back" onClick={onBackToMain}>
          ‹ {aT('返回', 'Go back')}
        </button>
        <ColorPicker aT={aT} value={value} onChange={onChange} />
      </>
    );
  }
  return (
    <>
      <div className="mes-label">{aT('页面底色', 'Page background')}</div>
      <div className="mes-sw-row">
        {/* 无背景:与画板背景弹窗的「无」同一个斜线格视觉 */}
        <button
          type="button"
          className={`mes-sw bbg-none${value == null ? ' active' : ''}`}
          aria-label={aT('无背景', 'None')}
          title={aT('无背景', 'None')}
          onClick={() => onChange(null)}
        />
        {COLOR_PRESETS.map((c) => (
          <button
            type="button"
            key={c}
            className={`mes-sw${value?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            aria-label={c}
            title={c}
            onClick={() => onChange(c)}
          />
        ))}
        <button
          type="button"
          className="mes-sw mes-sw-more"
          aria-label={aT('更多颜色', 'More colors')}
          title={aT('更多颜色', 'More colors')}
          onClick={onOpenPicker}
        />
      </div>
    </>
  );
}
