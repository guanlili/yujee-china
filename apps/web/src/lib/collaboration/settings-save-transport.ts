import type { BoardBackground } from '@/lib/board-bg/presets';
import type { PhotoFilterState } from '@/lib/photo/filter-state';

// 全局创作设置 OCC 传输层(Phase 2B):title/画板背景/全书滤镜 PATCH 的公共通道,
// 桌面(EditorShell 的滤镜保存器 + EditorBook 的标题/背景)与移动端共用。
//
// 映射口径(collab rework plan §3):
//   200 + ok                 → 成功;data 回显服务端规范化后的字段值,settingsRevision
//                              是推进后的新基线,调用方必须推进本地 ref
//   409 SETTINGS_CONFLICT    → conflict(零写入);details.currentSettingsRevision 是
//                              服务器当前基线 —— 调用方采纳它(否则本地基线永远落后,
//                              之后每次设置写入都 409 死胡同),同时回滚乐观 UI;
//                              用户再次编辑即在新基线上正常写入
//   401 / 403                → forbidden(被移除出成员/未登录;停止自动重试)
//   其余(含网络异常)          → network(可重试)
export type AlbumSettingsPatch =
  | { title: string }
  | { boardBackground: BoardBackground | null }
  | { photoFilter: PhotoFilterState | null };

export type SettingsSaveOutcome =
  | { ok: true; settingsRevision: number; data?: unknown }
  | { ok: false; kind: 'conflict'; currentSettingsRevision: number | null }
  | { ok: false; kind: 'forbidden' }
  | { ok: false; kind: 'network' };

export async function saveAlbumSettings(opts: {
  albumId: string;
  patch: AlbumSettingsPatch;
  baseSettingsRevision: number;
  signal?: AbortSignal;
}): Promise<SettingsSaveOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/albums/${opts.albumId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...opts.patch, baseSettingsRevision: opts.baseSettingsRevision }),
      signal: opts.signal,
    });
  } catch {
    // fetch 抛异常 = 网络失败或被 abort(用户继续拖滤镜,上一轮在途请求让位给
    // 下一轮)。abort 场景由调用方协调器用 signal.aborted 守卫丢弃,这里统一按
    // network 上报即可。
    return { ok: false, kind: 'network' };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: 'forbidden' };
  }

  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: { code?: string; details?: { currentSettingsRevision?: number } };
  } | null;

  if (res.status === 409 && json?.error?.code === 'SETTINGS_CONFLICT') {
    return {
      ok: false,
      kind: 'conflict',
      currentSettingsRevision:
        typeof json.error.details?.currentSettingsRevision === 'number'
          ? json.error.details.currentSettingsRevision
          : null,
    };
  }

  if (res.ok && json?.ok) {
    const [field] = Object.keys(opts.patch);
    return {
      ok: true,
      settingsRevision:
        typeof json.data?.settingsRevision === 'number' ? json.data.settingsRevision : 0,
      data: json.data?.[field],
    };
  }

  return { ok: false, kind: 'network' };
}
