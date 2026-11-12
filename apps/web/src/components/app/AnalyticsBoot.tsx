'use client';

import { useEffect } from 'react';
import { installAnalyticsErrorHooks } from '@/lib/analytics/track-client';

// 全局只做一件事:挂前端错误上报的监听。
// 不在这里做页面浏览统计 —— 那样每个路由都会漏记或重记,不如按需要埋关键动作
// (首页、导出、上传、购买),事件少而准,看得懂。
export function AnalyticsBoot() {
  useEffect(() => {
    installAnalyticsErrorHooks();
  }, []);
  return null;
}
