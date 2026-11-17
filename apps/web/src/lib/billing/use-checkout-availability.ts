// 客户端读「购买通道现在能不能用」。
//
// 数据来自 GET /api/v1/billing/checkout-availability(服务端算的是同一套 isCheckoutConfigured)。
// 组件拿 process.env 拿不到密钥,所以必须走这一趟。
//
// 三条行为约定,别改:
// - 初始 true:在请求回来之前先按「能用」渲染。反过来会让正常通道闪一下禁用态。
// - 失败保持 true:网络或接口出错不等于通道没配好,不能因为一次失败就关掉真实可售的入口。
// - 只读一次:凭据是部署期常量,同一页面生命周期内不会变。

'use client';

import { useEffect, useState } from 'react';

export function useCheckoutAvailability(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/billing/checkout-availability', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { enabled?: unknown } | null) => {
        if (!alive || !body) return;
        if (typeof body.enabled === 'boolean') setEnabled(body.enabled);
      })
      .catch(() => {
        /* 保持 true —— 见文件头约定 */
      });
    return () => {
      alive = false;
    };
  }, []);

  return enabled;
}
