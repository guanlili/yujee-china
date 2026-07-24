'use client';

/* 真正的移动端编辑器(样例数据)。给 /dev/mobile 的手机外壳当 iframe 内容,
   真机也可直接访问这个地址。返回按钮在这里是空操作 —— 预览页不该把人踢出去。 */

import { use } from 'react';

import { MobileEditorRoot } from '@/components/album/editor-v2/mobile/MobileEditorRoot';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';
import { SAMPLE_DETAIL } from '../sample';

export default function DevMobileFrame({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  return <MobileEditorRoot detail={SAMPLE_DETAIL} locale={locale} onBack={() => {}} />;
}
