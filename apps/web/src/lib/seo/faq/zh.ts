import {
  FREE_PLAN_CREDITS,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import type { FaqEntry } from './types';

export const ZH: readonly FaqEntry[] = [
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
    q: '照片书排版免费吗？',
    a: `可以先免费用。注册即送 ${FREE_PLAN_CREDITS} 积分，够排完一本。1 积分 = ${PHOTOS_PER_CREDIT} 张照片，一本约 ${PAGES_PER_CREDIT_LABEL} 页。没有订阅。`,
  },
];
