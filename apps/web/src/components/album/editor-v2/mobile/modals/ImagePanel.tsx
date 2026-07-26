'use client';

/* 图片编辑面板(塞进 ElementSheet)。

   线上图片编辑就三件:**拖动平移 + 缩放 + 复位**(桌面 .img-edit-overlay:
   一根 zoom 滑块 + 「复位」+ 「拖动平移」提示)。换图线上并不存在,不要造。

   移动端把平移/捏合放在页面上直接做(手指就在图上),这里只留滑块与复位 ——
   与桌面同样的三件,只是触点换成适合拇指的尺寸。 */

import { SCALE_MAX, SCALE_MIN, type ImagePosValue } from '../../image-edit-util';

export type ImagePanelProps = {
  zh: boolean;
  pos: ImagePosValue;
  onChange: (pos: ImagePosValue) => void;
  onReset: () => void;
};

export function ImagePanel({ zh, pos, onChange, onReset }: ImagePanelProps) {
  return (
    <>
      <p className="mes-hint">
        {zh
          ? '在页面上直接拖动可以挪动画面,双指捏合可以放大。'
          : 'Drag on the page to move the photo; pinch to zoom.'}
      </p>

      <div className="mes-label">{zh ? '缩放' : 'Zoom'}</div>
      <div className="mes-zoom-row">
        <button
          type="button"
          className="mes-tb mes-tb-step"
          aria-label={zh ? '缩小' : 'Zoom out'}
          onClick={() => onChange({ ...pos, scale: pos.scale - 0.05 })}
        >
          −
        </button>
        <input
          className="mes-zoom"
          type="range"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={0.01}
          value={pos.scale}
          aria-label={zh ? '缩放' : 'Zoom'}
          onChange={(e) => onChange({ ...pos, scale: Number(e.target.value) })}
        />
        <button
          type="button"
          className="mes-tb mes-tb-step"
          aria-label={zh ? '放大' : 'Zoom in'}
          onClick={() => onChange({ ...pos, scale: pos.scale + 0.05 })}
        >
          +
        </button>
        <span className="mes-zoom-val">{pos.scale.toFixed(2)}×</span>
      </div>

      <div className="mes-label">{zh ? '位置' : 'Position'}</div>
      <div className="mes-sw-row">
        <button type="button" className="mes-reset" onClick={onReset}>
          {zh ? '复位' : 'Reset'}
        </button>
        <span className="mes-zoom-val">
          {Math.round(pos.x)}% · {Math.round(pos.y)}%
        </span>
      </div>
    </>
  );
}
