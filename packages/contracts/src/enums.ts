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
 * 艺术字字体 id：既是每章 `artFont` 的取值，也是设计 Agent 写进 `${slot}#artFont`
 * carrier 的值、web `theme-carrier` 的映射键。**与品牌正文字体无关**，是排版专用艺术字落点。
 *
 * B1 定稿（2026-07）：从 4 个抽象包扩成**真实字体库**（中文 9 + 英文，按角色 标题/正文/装饰
 * 分工，见 design-agent `font-registry.ts` 与「相册字体」技能）。设计 Agent 不 import 本文件
 * （避免破坏 tsgo 构建），故 id 清单在 contracts / design-agent `font-registry.ts` /
 * web `theme-carrier.ts` 三处**手工对齐**，增删字体三处同步。
 *
 * 旧的 4 个抽象包（serif-classic 等）保留以兼容 dormant 的 theme/finalize 流与既有 fixtures，
 * 待确认该流彻底废弃后可移除。
 */
export const ArtFontPack = z.enum([
  // —— 旧占位包（兼容保留，勿新用）——
  'serif-classic',
  'sans-modern',
  'script-elegant',
  'display-bold',
  // —— 中文（9）——
  'noto-serif-sc', // 思源宋体
  'noto-sans-sc', // 思源黑体
  'zcool-xiaowei', // 站酷小薇
  'lxgw-wenkai', // 霞鹜文楷
  'smiley-sans', // 得意黑
  'zcool-qingke-huangyou', // 站酷庆科黄油体
  'long-cang', // 龙藏
  'zhi-mang-xing', // 志莽行书
  'liu-jian-mao-cao', // 柳建毛草
  // —— 英文 · 正文 ——
  'eb-garamond',
  'source-serif-4',
  'lora',
  'libre-baskerville',
  'inter',
  'work-sans',
  'dm-sans',
  'poppins',
  'raleway',
  // —— 英文 · 标题 ——
  'playfair-display',
  'cormorant-garamond',
  'bebas-neue',
  'archivo-black',
  'abril-fatface',
  'montserrat',
  // —— 英文 · 装饰 ——
  'ibm-plex-mono',
  'jetbrains-mono',
  'great-vibes',
  'dancing-script',
  'sacramento',
  'parisienne',
]);
export type ArtFontPack = z.infer<typeof ArtFontPack>;
