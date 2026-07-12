import { PHOTOS_PER_CREDIT } from '@/config/pricing';
import type { Locale } from '@/lib/i18n/routing';

/**
 * The landing FAQ, as plain prose.
 *
 * SINGLE SOURCE OF TRUTH. The landing page renders these strings and the
 * FAQPage JSON-LD serialises them, so the structured data can never drift from
 * what a visitor actually reads — which is exactly what Google penalises.
 *
 * The last answer is rendered on the page with an inline link to the pricing
 * section; the link is presentation, so it lives in the component and the prose
 * here stays markup-free (JSON-LD answers must be text).
 */
export interface FaqEntry {
  q: string;
  a: string;
}

const EN: readonly FaqEntry[] = [
  {
    q: 'Do I need design skills?',
    a: 'Not at all. You just pick photos; the AI handles layout, grouping and a first draft of captions. Everything stays editable — be as hands-on as you like.',
  },
  {
    q: 'What export formats are there?',
    a: 'A 300 DPI print-ready PDF — download it, share it, or send it straight to a print shop to bind.',
  },
  {
    q: 'Are my photos safe?',
    a: 'Original photos are never uploaded — only compressed previews go to the AI for layout planning. Our servers keep your layout data and the PDF and cover you export, so you can reopen and download your book anytime. Your albums are visible only to you and are never made public.',
  },
  {
    q: 'How long does a book take?',
    a: 'Within minutes of uploading you get a flip-through draft. Refine it for as long as you like — progress saves automatically.',
  },
  {
    q: 'Can I edit and add photos later?',
    a: 'Yes. Every page is editable and you can add new photos anytime — albums like baby growth are built to keep updating.',
  },
  {
    q: 'Is it free?',
    a: `Sign-up comes with a free credit — enough for a first book of up to ${PHOTOS_PER_CREDIT} photos. Generating a book uses credits based on how many photos you add (${PHOTOS_PER_CREDIT} photos per credit). No subscription.`,
  },
];

const ZH: readonly FaqEntry[] = [
  {
    q: '需要会设计才能用吗？',
    a: '完全不需要。你只要选照片，AI 负责排版、分组和配文初稿。所有结果都能再手动调整。',
  },
  {
    q: '支持导出哪些格式？',
    a: '300DPI 的印刷级 PDF，可以下载分享，也可以直接送打印装订。',
  },
  {
    q: '我的照片安全吗？',
    a: '原图不会上传：生成时只发送压缩预览给 AI 用于排版。服务端保存排版数据，以及你导出的成品 PDF 和封面缩略图，供你随时重新打开和下载。相册只有你自己可见，不会公开。',
  },
  {
    q: '做一本大概要多久？',
    a: '上传后几分钟内就能拿到一本可翻阅的样书。之后想精修多久都行。',
  },
  {
    q: '可以中途修改、继续添加照片吗？',
    a: '可以。每一页都能手动调整，也能随时加入新照片。',
  },
  {
    q: '免费吗？',
    a: `注册即送 1 积分，可免费做一本 ${PHOTOS_PER_CREDIT} 张照片以内的册子。生成相册按照片数量消耗积分（每 ${PHOTOS_PER_CREDIT} 张照片 1 积分）。没有订阅、没有月费。`,
  },
];

export function getFaqEntries(locale: Locale): readonly FaqEntry[] {
  return locale === 'zh' ? ZH : EN;
}
