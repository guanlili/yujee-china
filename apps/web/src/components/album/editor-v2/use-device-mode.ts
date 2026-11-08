'use client';

import { useEffect, useState } from 'react';
import { resolveDeviceMode, type DeviceMode } from './mobile-canvas';

/* 设备判定的唯一入口。判定规则本身仍来自 resolveDeviceMode(<=767 为 mobile),
   不新造第二个真值源 —— 桌面端 CSS 与它同一条边界。

   为什么可以在 render 里读 window:编辑器路由是 'use client' + 轮询,服务端预渲染
   与首帧(hydration)一律落在 loading 分支,画布要到轮询返回后才挂 —— 那时早已在
   客户端。SSR 分支返回 'desktop' 只是占位,不会被画布用到,因此不存在 hydration 错配。 */

/** 触摸设备按**短边**判定(2026-11-08 修)。
    起因:手机横屏时 innerWidth 变成 932 这类桌面宽度,判定直接落到 desktop ——
    用户把手机转个方向就掉进 5500 行的桌面画布,布局、手势、工具栏全换成另一套。
    短边才是手机的物理尺寸(iPhone 横屏短边仍是 390–430)。
    非触摸设备(macOS/Windows 的鼠标、触控板都是 fine 指针)保持按宽度判定,
    免得桌面窄窗口被误判成手机。 */
export function effectiveViewportWidth(
  width: number,
  height: number,
  coarsePointer: boolean,
): number {
  return coarsePointer ? Math.min(width, height) : width;
}

function currentMode(): DeviceMode {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return resolveDeviceMode(effectiveViewportWidth(window.innerWidth, window.innerHeight, coarse));
}

export function useDeviceMode(): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>(() =>
    typeof window === 'undefined' ? 'desktop' : currentMode(),
  );

  useEffect(() => {
    const read = () => setMode(currentMode());
    read(); // 首个 effect 校正:SSR 占位值在这里被真实宽度覆盖
    window.addEventListener('resize', read);
    // 旋转时 iOS 的 resize 有时晚一拍,orientationchange 补一手(横屏掉进桌面画布就是这条漏的)
    window.addEventListener('orientationchange', read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
    };
  }, []);

  return mode;
}
