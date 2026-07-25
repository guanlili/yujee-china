'use client';

/* 移动端编辑器的本地预览页(dev-only):样例数据,不接 DB / 登录 / agent。
   直接渲染本体 —— 不套手机外壳,浏览器窗口多窄就多窄地看。
   返回按钮在这里是空操作:预览页不该把人踢出真实站点。 */

import { use } from 'react';

import { MobileEditorRoot } from '@/components/album/editor-v2/mobile/MobileEditorRoot';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';
import { SAMPLE_DETAIL } from './sample';

export default function DevMobilePreview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  return <MobileEditorRoot detail={SAMPLE_DETAIL} locale={locale} onBack={() => {}} />;
}
