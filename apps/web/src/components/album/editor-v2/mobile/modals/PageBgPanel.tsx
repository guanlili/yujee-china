'use client';

/* 页面底色面板(mes 的 page 模式)—— 只管**当前这一页的底色**,与画板垫底背景
   是两回事(后者在浏览态左下角,走 BoardBgSheet)。

   类名沿用 .mes-sw / .mes-label,与文字面板的颜色行同一套视觉。 */

import { COLOR_PRESETS } from '@/lib/board-bg/presets';

export type PageBgPanelProps = {
  zh: boolean;
  /** 当前页底色;null = 无背景(透出纸白)。 */
  value: string | null;
  onChange: (color: string | null) => void;
};

export function PageBgPanel({ zh, value, onChange }: PageBgPanelProps) {
  return (
    <>
      <div className="mes-label">{zh ? '页面底色' : 'Page background'}</div>
      <div className="mes-sw-row">
        {/* 无背景:与画板背景弹窗的「无」同一个斜线格视觉 */}
        <button
          type="button"
          className={`mes-sw bbg-none${value == null ? ' active' : ''}`}
          aria-label={zh ? '无背景' : 'None'}
          title={zh ? '无背景' : 'None'}
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
      </div>
    </>
  );
}
