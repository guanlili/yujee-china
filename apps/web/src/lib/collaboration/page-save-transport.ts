import type { SaveOutcome, SaveTransport } from './page-save-coordinator';

// 真实 fetch 传输层:桌面/移动端共用。把 PATCH /pages/{idx} 的响应翻译成
// 协调器的三态 SaveOutcome。
//
// 映射口径(collab plan §7.5/§9.2):
//   200 + ok            → 成功(data.version 有值才串接;legacy 盲写无 version)
//   409 EDIT_CONFLICT   → conflict(details.currentVersion 供「重新加载」)
//   409 REVISION_AHEAD  → conflict(整书 revision 错位,同样只能重载;currentVersion
//                          取不到就给 0,resolveConflict/reload 流程以服务器为准)
//   401 / 403           → forbidden(被移除出成员/未登录/游客门禁;停止自动重试)
//   其余(含网络异常)     → network(可重试)
export function createFetchPageSaveTransport(albumId: string): SaveTransport {
  return {
    async save(pageIndex, baseVersion, patch) {
      let res: Response;
      try {
        res = await fetch(`/api/v1/albums/${albumId}/pages/${pageIndex}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...patch, ...(baseVersion !== null ? { baseVersion } : {}) }),
        });
      } catch {
        return { ok: 'error', kind: 'network' };
      }

      if (res.status === 401 || res.status === 403) {
        return { ok: 'error', kind: 'forbidden' };
      }

      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: { version?: number; revision?: number };
        error?: { code?: string; details?: { currentVersion?: number } };
      } | null;

      if (res.status === 409) {
        const code = json?.error?.code;
        if (code === 'EDIT_CONFLICT' || code === 'REVISION_AHEAD') {
          return {
            ok: 'conflict',
            currentVersion: json?.error?.details?.currentVersion ?? 0,
          };
        }
        return { ok: 'error', kind: 'network' };
      }

      if (res.ok && json?.ok) {
        return {
          ok: true,
          version: typeof json.data?.version === 'number' ? json.data.version : null,
          revision: typeof json.data?.revision === 'number' ? json.data.revision : null,
        };
      }

      return { ok: 'error', kind: 'network' };
    },
  };
}

// 测试与类型导出护栏:确保 outcome 形状被静态约束(避免手写分支漏字段)。
export type { SaveOutcome };
