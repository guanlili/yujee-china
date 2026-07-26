'use client';

/* 完整取色器 —— 与桌面「填充」面板同一套构件:
     SV 方块(横=饱和,竖=明度) + 色相条 + 透明度条 + hex 输入 + 不透明度输入。
   颜色换算走共享的 color-util(桌面同一份),这里只负责手势与呈现。

   三处共用它(与桌面「同一个取色器服务三处」一致):文字颜色 / 书页底色 / 画板背景。
   触点按拇指放大:方块 180px 高、两条轨 22px 高 —— 桌面那套是给鼠标的,直接照搬会太细。 */

import { useRef } from 'react';

import {
  clamp01,
  hsvToHex,
  parseColor,
  toCssColor,
  type Hsv,
} from '../../color-util';

export type ColorPickerProps = {
  zh: boolean;
  /** 当前颜色(#rrggbb / rgba());null = 还没有值,给个中性起点。 */
  value: string | null;
  /** 要不要透明度轨(文字/底色要,画板纯色也要;不需要时整条不出现)。 */
  withAlpha?: boolean;
  onChange: (css: string) => void;
};

const FALLBACK: Hsv = { h: 0, s: 0, v: 0.07 }; // 接近产品的 --fg(#111)

export function ColorPicker({ zh, value, withAlpha = true, onChange }: ColorPickerProps) {
  const parsed = parseColor(value);
  const hsv = parsed?.hsv ?? FALLBACK;
  const alpha = parsed?.alpha ?? 1;

  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);

  const emit = (next: Partial<Hsv>, nextAlpha = alpha) =>
    onChange(toCssColor({ ...hsv, ...next }, nextAlpha));

  /** 一条轨/一个方块上的拖拽:按下即取值,拖动持续取值(指针捕获,手指滑出也不断)。 */
  const track = (
    ref: React.RefObject<HTMLDivElement | null>,
    read: (fx: number, fy: number) => void,
  ) => {
    const pick = (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      read(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
      },
      onPointerUp: (e: React.PointerEvent) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      },
    };
  };

  const hueHex = hsvToHex(hsv.h, 1, 1);
  const solidHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <div className="mcp">
      {/* SV 方块:底色是当前色相,叠白→透明(横)与透明→黑(竖) */}
      <div
        ref={svRef}
        className="mcp-sv"
        style={{ background: hueHex }}
        role="slider"
        aria-label={zh ? '饱和度与明度' : 'Saturation and brightness'}
        aria-valuetext={solidHex}
        {...track(svRef, (fx, fy) => emit({ s: fx, v: 1 - fy }))}
      >
        <div className="mcp-sv-white" />
        <div className="mcp-sv-black" />
        <span
          className="mcp-dot"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: solidHex }}
        />
      </div>

      {/* 色相条 */}
      <div
        ref={hueRef}
        className="mcp-track mcp-hue"
        role="slider"
        aria-label={zh ? '色相' : 'Hue'}
        aria-valuenow={Math.round(hsv.h)}
        {...track(hueRef, (fx) => emit({ h: fx * 360 }))}
      >
        <span className="mcp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex }} />
      </div>

      {/* 透明度条 */}
      {withAlpha && (
        <div
          ref={alphaRef}
          className="mcp-track mcp-alpha"
          role="slider"
          aria-label={zh ? '不透明度' : 'Opacity'}
          aria-valuenow={Math.round(alpha * 100)}
          {...track(alphaRef, (fx) => emit({}, fx))}
        >
          <span
            className="mcp-alpha-bg"
            style={{ background: `linear-gradient(90deg, transparent, ${solidHex})` }}
          />
          <span className="mcp-thumb" style={{ left: `${alpha * 100}%`, background: solidHex }} />
        </div>
      )}

      {/* hex + 不透明度数值 */}
      <div className="mcp-fields">
        <span className="mcp-hex">
          <b>#</b>
          <input
            className="mcp-hex-input"
            maxLength={6}
            spellCheck={false}
            inputMode="text"
            aria-label={zh ? '十六进制颜色' : 'Hex colour'}
            value={solidHex.slice(1).toUpperCase()}
            onChange={(e) => {
              const p = parseColor(`#${e.target.value.trim()}`);
              if (p) onChange(toCssColor(p.hsv, alpha));
            }}
          />
        </span>
        {withAlpha && (
          <span className="mcp-alpha-field">
            <input
              className="mcp-alpha-input"
              inputMode="numeric"
              aria-label={zh ? '不透明度百分比' : 'Opacity percent'}
              value={Math.round(alpha * 100)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) onChange(toCssColor(hsv, clamp01(n / 100)));
              }}
            />
            <b>%</b>
          </span>
        )}
      </div>
    </div>
  );
}
