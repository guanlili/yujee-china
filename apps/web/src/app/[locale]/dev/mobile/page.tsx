'use client';

/* 移动端编辑器(浏览态)的本地预览页 —— 不接 DB / 登录 / agent。
   造几页样例书直接挂 MobileEditorRoot,用来在手机视口/真机上验证翻页、密度、
   独页封面的手感。仅 dev 用;样例页面外观走自带 htmlJson 卡片(不依赖照片),
   templateId 用真实的以触发封面/封底独页语义(mag-01=cover / mag-20=ending)。 */

import { use } from 'react';

import { MobileEditorRoot } from '@/components/album/editor-v2/mobile/MobileEditorRoot';
import type { AlbumDetail, EditorPage } from '@/components/album/types';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';

const PALETTE = ['#13B8A6', '#8C5EF4', '#EF6F53', '#3B82F6', '#E4B04A', '#DB5A8B'];

function card(pageIndex: number, templateId: string, kicker: string, title: string): EditorPage {
  const bg = PALETTE[pageIndex % PALETTE.length];
  const html =
    `<div style="width:794px;height:1123px;box-sizing:border-box;position:relative;` +
    `background:linear-gradient(160deg,${bg},#1c1b19);color:#fff;` +
    `font-family:'Noto Sans SC',sans-serif;overflow:hidden">` +
    `<div style="position:absolute;top:80px;left:64px;font-size:26px;letter-spacing:.3em;opacity:.7">${kicker}</div>` +
    `<div style="position:absolute;top:150px;left:64px;right:64px;font-size:76px;font-weight:800;line-height:1.15">${title}</div>` +
    `<div style="position:absolute;bottom:60px;right:64px;font-size:200px;font-weight:800;opacity:.16">${pageIndex}</div>` +
    `</div>`;
  return { pageIndex, templateId, imagesJson: {}, textsJson: {}, htmlJson: html };
}

const SAMPLE_PAGES: EditorPage[] = [
  card(0, 'mag-01', 'YUJEE', '厦门三日游'),
  card(1, 'mag-03', 'DAY 1', '海边时光'),
  card(2, 'mag-03', '', '沙滩 · 日出 · 海浪'),
  card(3, 'mag-03', 'DAY 2', '古街探味'),
  card(4, 'mag-03', '', '小巷 · 美食 · 灯笼'),
  card(5, 'mag-03', 'DAY 3', '日落归途'),
  card(6, 'mag-03', '', '山路 · 晚霞 · 剪影'),
  card(7, 'mag-20', 'THE END', '下次再见'),
];

const SAMPLE_DETAIL: AlbumDetail = {
  album: {
    id: 'dev-mobile-preview',
    title: '厦门三日游(预览)',
    status: 'COMPLETED',
    prompt: '',
    layoutJson: {},
    photoCount: 0,
    pageCount: SAMPLE_PAGES.length,
    pdfUrl: null,
    boardBackground: { kind: 'color', color: '#2a2723' },
    errorMessage: null,
    createdAt: new Date(0).toISOString(),
  },
  pages: SAMPLE_PAGES,
};

export default function DevMobilePreview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = use(params);
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  return <MobileEditorRoot detail={SAMPLE_DETAIL} locale={locale} />;
}
