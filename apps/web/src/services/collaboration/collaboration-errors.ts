import { AppError } from '@/lib/api/error-codes';

// 协同模块错误(collab plan §14)。独立于全局 ERRORS 注册表:协同的错误语义
// 只被协同链路消费,集中放在模块里保持深模块边界。HTTP 状态与计划 §14 对齐;
// message 可本地化,客户端逻辑只允许依赖 code 和(Task 3 起的)结构化 details。
export const COLLAB_ERRORS = {
  // 不是 owner 也不是 editor(访问白名单读路径/单页 PATCH 时)。
  ALBUM_ACCESS_DENIED: () =>
    new AppError('ALBUM_ACCESS_DENIED', 'You do not have access to this album', 403),

  // editor 调用了 owner-only 的协同操作(如创建/旋转编辑链接)。
  OWNER_REQUIRED: () =>
    new AppError('OWNER_REQUIRED', 'Only the album owner can do this', 403),

  // 编辑链接无效或已被旋转。404 而非 403:不向持旧 token 者泄露链接是否曾存在。
  EDIT_LINK_NOT_FOUND: () =>
    new AppError('EDIT_LINK_NOT_FOUND', 'This edit link is invalid or was revoked', 404),

  // 相册不走带 version 的 V3 draft_pages 路径(已定稿/未播种/legacy),
  // 不能进入协同。409 = 状态冲突而非权限缺失。
  COLLAB_UNSUPPORTED_ALBUM: () =>
    new AppError('COLLAB_UNSUPPORTED_ALBUM', 'This album does not support collaborative editing', 409),

  // 页面 OCC 冲突(collab plan §7.5):客户端提交的 baseVersion 已过期。
  // details 是结构化契约(客户端「查看最新版本」依赖它),携带当前版本号与
  // 当前页全文 —— 页面正文**只**允许经此响应通道返回,绝不写日志(collab §19)。
  EDIT_CONFLICT: (details: {
    pageIndex: number;
    currentVersion: number;
    currentPage: unknown;
  }) => new AppError('EDIT_CONFLICT', 'Page changed since it was loaded', 409, details),

  // 结构 OCC 冲突(Phase 2A):reorder/delete 提交的 baseStructureRevision 已过期
  // (并发结构写/结构写后陈旧客户端)。details 只带 currentStructureRevision,
  // 让客户端整书重载对齐基线 —— 不带任何页面正文,与 EDIT_CONFLICT 的
  // currentPage 通道刻意区分(结构冲突只需重载,不需「查看最新」)。
  STRUCTURE_CONFLICT: (details: { currentStructureRevision: number }) =>
    new AppError('STRUCTURE_CONFLICT', 'Page structure changed since it was loaded', 409, details),

  // 全局创作设置 OCC 冲突(Phase 2B):title/boardBackground/photoFilter 提交的
  // baseSettingsRevision 已过期(并发设置写/设置写后陈旧客户端)。details 只带
  // currentSettingsRevision,让客户端对齐基线后重存 —— 不带任何正文,与
  // EDIT_CONFLICT 的 currentPage 通道刻意区分。
  SETTINGS_CONFLICT: (details: { currentSettingsRevision: number }) =>
    new AppError('SETTINGS_CONFLICT', 'Album settings changed since they were loaded', 409, details),

  // 增量同步(collab plan §7.4):客户端上报的 since 高于服务器当前 revision
  // (多标签页/时钟错乱/数据回滚)。409 让客户端整书重载,不做差集猜测。
  REVISION_AHEAD: (details: { since: number; currentRevision: number }) =>
    new AppError('REVISION_AHEAD', 'Client revision is ahead of the server', 409, details),

  // 创建邀请前照片尚未可供协作者读取(collab plan §13):editor 只能依赖服务器
  // 原图,缺一张就拒绝创建,不接受「能进编辑器但大量空图」的半可用状态。
  PHOTO_BACKUP_REQUIRED: () =>
    new AppError('PHOTO_BACKUP_REQUIRED', 'Some photos are not backed up to the server yet', 409),

  // AI 长任务结果过期(collab rework §Phase 4):job 启动时记录的基线(结构/设置/
  // 页版本)与完成回写时的锁内现状失配 —— 期间发生了人工修改,直接回写会覆盖。
  // 服务端零写入、AI 结果不落库;客户端提示基于最新版本重跑。details 只带失配
  // 维度的当前值(与 STRUCTURE/SETTINGS_CONFLICT 同口径,不带页面正文)。
  AI_RESULT_STALE: (details: {
    currentStructureRevision: number;
    currentSettingsRevision: number;
  }) =>
    new AppError(
      'AI_RESULT_STALE',
      'The book changed while the AI was running — rerun on the latest version',
      409,
      details,
    ),
} as const;
