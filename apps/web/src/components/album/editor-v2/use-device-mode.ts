'use client';

import { useEffect, useState } from 'react';
import { resolveDeviceMode, type DeviceMode } from './mobile-canvas';

/* 设备判定的唯一入口。判定规则本身仍来自 resolveDeviceMode(<=767 为 mobile),
   不新造第二个真值源 —— 桌面端 CSS 与它同一条边界。

   为什么可以在 render 里读 window:编辑器路由是 'use client' + 轮询,服务端预渲染
   与首帧(hydration)一律落在 loading 分支,画布要到轮询返回后才挂 —— 那时早已在
   客户端。SSR 分支返回 'desktop' 只是占位,不会被画布用到,因此不存在 hydration 错配。 */
export function useDeviceMode(): DeviceMode {
  const [mode, setMode] = useState<DeviceMode>(() =>
    typeof window === 'undefined' ? 'desktop' : resolveDeviceMode(window.innerWidth),
  );

  useEffect(() => {
    const read = () => setMode(resolveDeviceMode(window.innerWidth));
    read(); // 首个 effect 校正:SSR 占位值在这里被真实宽度覆盖
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  return mode;
}
