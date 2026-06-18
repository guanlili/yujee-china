import { z } from 'zod';

export const AlbumStatus = z.enum([
  'AGENT_RUNNING',
  'EDITING',
  'COMPLETED',
  'FAILED',
]);
export type AlbumStatus = z.infer<typeof AlbumStatus>;

export const JobStatus = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const CallbackEvent = z.enum(['progress', 'completed', 'failed']);
export type CallbackEvent = z.infer<typeof CallbackEvent>;

// ────────────────────────────── V3 五环节状态机 ──────────────────────────────

/**
 * 整本相册的五环节状态(architecture §6.8 第 4 条):Web 唯一真相源,Agent 不持。
 * 与 `albums.status`(init 任务生命周期 + 积分)正交并存,互不派生。
 * 迁移 `0007`:`album_stage` pgEnum 用这同一组值。
 */
export const AlbumStage = z.enum([
  'analysing', // ① 分析(后台异步跑)
  'story', // ② 章节故事
  'theme', // ③ 确定主题与章节色
  'cover', // ④ 书籍设计(封面/封尾,可跳过)
  'ready', // ⑤ 待导出
]);
export type AlbumStage = z.infer<typeof AlbumStage>;

// ────────────────────────────── V3 模板分类 ──────────────────────────────

/**
 * 模板分类(v3-requirements §9):替代旧 `slot` + `scene`,决定进哪个环节候选池。
 * `interior` 才有 `pairing` 意义;`toc` 目录页;`ending` 封尾。
 */
export const TemplateCategory = z.enum(['cover', 'interior', 'toc', 'ending']);
export type TemplateCategory = z.infer<typeof TemplateCategory>;

// ────────────────────────────── V3 字体包 ──────────────────────────────

/**
 * 艺术字字体包(v3-requirements §4.3):品牌字体库固定、就那么几个,用户在主题环节选其一,
 * 写入每章 `artFont`。**与品牌正文字体无关**,是排版专用的艺术字落点。
 * ⚠️ 成员清单由模板维护方最终敲定(v3-implementation-plan §3 WP0.1 风险项);
 *    此处先按现行模板资产登记一组占位合法集,WP0.2 模板维护方确认后可增删。
 */
export const ArtFontPack = z.enum([
  'serif-classic', // 经典衬线
  'sans-modern', // 现代无衬线
  'script-elegant', // 优雅手写体
  'display-bold', // 标题展示体
]);
export type ArtFontPack = z.infer<typeof ArtFontPack>;
