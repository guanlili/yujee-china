// 产品授权唯一真相(collab rework §4.1):owner/editor 都是完整 Creator,owner
// 只额外拥有治理权。纯函数、零副作用 —— 服务端(collaboration-service 的锁内
// 检查)与前端(React 组件的入口显隐)消费**同一份**定义,两端口径不可能漂移。
//
// 前端显隐只是体验;每条能力在后端都有对应的锁内检查兜底 —— 绕过 UI 直接
// 调 API 的请求由服务端拒绝。

export type AlbumRole = 'owner' | 'editor';

export type CreatorCapability =
  | 'editContent'
  | 'editStructure'
  | 'editSettings'
  | 'uploadPhotos'
  | 'runAI'
  | 'export'
  | 'createShare';
export type OwnerCapability = 'manageMembers' | 'deleteAlbum' | 'transferOwnership';
export type AlbumCapability = CreatorCapability | OwnerCapability;
export type AlbumCapabilities = ReadonlySet<AlbumCapability>;

export const CREATOR_CAPABILITIES: ReadonlySet<AlbumCapability> = new Set([
  'editContent',
  'editStructure',
  'editSettings',
  'uploadPhotos',
  'runAI',
  'export',
  'createShare',
]);

export const OWNER_ONLY_CAPABILITIES: ReadonlySet<AlbumCapability> = new Set([
  'manageMembers',
  'deleteAlbum',
  'transferOwnership',
]);

export function albumCapabilities(role: AlbumRole): AlbumCapabilities {
  if (role === 'owner') {
    return new Set<AlbumCapability>([...CREATOR_CAPABILITIES, ...OWNER_ONLY_CAPABILITIES]);
  }
  return CREATOR_CAPABILITIES;
}

// 组件侧的便捷判据:role 来自 detail/draft DTO(旧响应无 role → undefined,
// 按 owner 处理 —— 与旧数据「看到全部入口」的历史行为一致,后端兜底)。
export function capabilitiesForRole(role: AlbumRole | undefined | null): AlbumCapabilities {
  return albumCapabilities(role === 'editor' ? 'editor' : 'owner');
}
