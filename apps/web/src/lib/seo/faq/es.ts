// TODO(i18n-translate): placeholder copy of en, to be replaced
import {
  FREE_PLAN_CREDITS,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import type { FaqEntry } from './types';

export const ES: readonly FaqEntry[] = [
  // Questions are phrased the way people actually search ("make a photo book",
  // "photo book layout") so the page and its FAQPage JSON-LD match real queries.
  // Facts must stay identical to the product — only the wording carries keywords.
  {
    q: 'Do I need design skills to make a photo book?',
    a: 'Not at all. You just pick photos; the AI photo book maker handles the layout, the grouping and a first draft of captions. Every page layout stays editable — be as hands-on as you like.',
  },
  {
    q: 'What format does my photo book export in?',
    a: 'A 300 DPI print-ready PDF — download it, share it, or send it straight to a print shop to print and bind your photo book.',
  },
  {
    q: 'Are my photos private and safe?',
    a: 'Original photos are never uploaded — only compressed previews go to the AI for layout planning. Our servers keep your layout data and the PDF and cover you export, so you can reopen and download your book anytime. Your albums are visible only to you and are never made public.',
  },
  {
    q: 'How long does it take to make a photo book?',
    a: 'Within minutes of uploading you get a flip-through draft of your book, automatically laid out like a magazine. Refine the layout for as long as you like — progress saves automatically.',
  },
  {
    q: 'Can I edit the layout or add photos later?',
    a: 'Yes. Every page layout is editable and you can add new photos anytime — memory books like a baby growth album are built to keep updating.',
  },
  {
    // Reworded, not added: an "Is Yujee free to use?" entry alongside this one
    // would be two questions with one answer. The grant is interpolated so the
    // claim can never outlive the constant.
    q: 'Is Yujee a free photo book maker?',
    a: `Yes, to start. Sign-up comes with ${FREE_PLAN_CREDITS} free credits — a whole free photobook, cover to cover. 1 credit = ${PHOTOS_PER_CREDIT} photo${PHOTOS_PER_CREDIT === 1 ? '' : 's'}, and a photo book is usually ${PAGES_PER_CREDIT_LABEL} pages. No subscription.`,
  },
];
