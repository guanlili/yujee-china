'use client';

// 协同邀请/成员的浏览器端 client(collab plan §7/§15)。桌面/移动共用。

export type CollabMember = {
  userId: string;
  name: string | null;
  email: string;
  createdAt: string;
};

export class CollabClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CollabClientError';
  }
}

async function responseJson(res: Response): Promise<any> {
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new CollabClientError(
      json?.error?.code ?? 'REQUEST_FAILED',
      json?.error?.message ?? `request failed (${res.status})`,
      res.status,
      json?.error?.details,
    );
  }
  return json.data;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return responseJson(res) as Promise<T>;
}

// 创建/旋转编辑链接(owner)。每次调用旋转 token,旧链接失效。响应带 token 与
// 拼好的 url。
export async function createEditLink(albumId: string): Promise<{ token: string }> {
  return postJson(`/api/v1/albums/${albumId}/edit-link`);
}

// 接受邀请(真实账号)。成功后返回 albumId,前端跳转到相册编辑器。
export async function redeemEditLink(token: string): Promise<{ albumId: string }> {
  return postJson(`/api/v1/edit-links/${encodeURIComponent(token)}/redeem`);
}

export async function listMembers(albumId: string): Promise<CollabMember[]> {
  const res = await fetch(`/api/v1/albums/${albumId}/members`, { cache: 'no-store' });
  return responseJson(res) as Promise<CollabMember[]>;
}

export async function removeMember(albumId: string, userId: string): Promise<{ removed: boolean }> {
  const res = await fetch(`/api/v1/albums/${albumId}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  return responseJson(res) as Promise<{ removed: boolean }>;
}
