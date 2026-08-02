// 照片原图对账补传(照片真相迁 R2 Phase 0, Task 8):把本机 IndexedDB 里已有、但
// 服务端 originals 表还没有的原图补传一遍。纯逻辑、依赖全注入(sign/put/confirm/
// getCanonicalUploadBlob 都是函数参数),不碰 DOM/IndexedDB/fetch,可在 node:test
// 下直接单测;真实绑定(client + photoStore)在 use-photo-original-sync.ts 里做。
//
// photoId 幂等:同一张重复经过这条流水线(sign→put→confirm)服务端应当接受为覆盖,
// 所以断点续传天然成立 —— 这次没传成的下次对账差集里还在,不需要额外的重试状态机。

import type {
  PhotoOriginalUploadEntry,
  SignedPhotoOriginalUpload,
} from './photo-original-client';

export type PhotoOriginalSyncDeps = {
  getCanonicalUploadBlob: (
    photoId: string,
  ) => Promise<{ blob: Blob; width: number; height: number } | undefined>;
  sign: (
    albumId: string,
    entries: PhotoOriginalUploadEntry[],
  ) => Promise<SignedPhotoOriginalUpload[]>;
  put: (putUrl: string, blob: Blob) => Promise<void>;
  confirm: (
    albumId: string,
    input: { entries?: PhotoOriginalUploadEntry[]; missing?: string[] },
  ) => Promise<{ uploaded: number; missing: number }>;
};

const PROBE_BATCH_SIZE = 300; // /photo-originals/urls 端点单次最多接受 300 个 photoId。

// 探测服务端已确认上传的 photoId 集合 —— 断点续传能生效的前提。/photo-originals/urls
// 只对 status='uploaded' 的 id 返回 URL,响应里出现的 key 集合就是 serverUploaded;
// 不探测的话每次触发都会把整批候选(哪怕早就传过)重新走一遍 sign→put→confirm。
// fetchUrls 独立注入(不是 PhotoOriginalSyncDeps 的一部分,因为它服务于「算出
// serverUploaded 传给 runPhotoOriginalSync」这一步,发生在 runPhotoOriginalSync
// 之前,不是它内部的上传流程)。任何一批探测失败都吞掉、退化为「这批当作没查到、
// 照常进候选重试」——安全但更费流量,绝不因为探测失败而跳过整次补传或抛出。
export async function probeServerUploaded(
  albumId: string,
  photoIds: string[],
  fetchUrls: (albumId: string, photoIds: string[]) => Promise<Record<string, string>>,
): Promise<ReadonlySet<string>> {
  const unique = [...new Set(photoIds.filter(Boolean))];
  const uploaded = new Set<string>();
  for (let i = 0; i < unique.length; i += PROBE_BATCH_SIZE) {
    const chunk = unique.slice(i, i + PROBE_BATCH_SIZE);
    try {
      const urls = await fetchUrls(albumId, chunk);
      for (const photoId of Object.keys(urls)) uploaded.add(photoId);
    } catch {
      // 这一批探测失败:不计入 serverUploaded(下面照常当候选重试),不影响其余
      // 批次已经探测到的结果,也不让探测阶段的失败中止整次补传。
    }
  }
  return uploaded;
}

// 差集,保序去重:排除服务端已确认上传的;服务端记为 missing 的(不在
// serverUploaded 里)不排除 —— 本机这次可能重新拿到了原图,值得再试一次。
export function planPhotoOriginalSync(
  bookPhotoIds: string[],
  serverUploaded: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of bookPhotoIds) {
    if (!id || seen.has(id) || serverUploaded.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

const UPLOAD_BATCH_SIZE = 50;
const PUT_CONCURRENCY = 3;

// 简单的并发工作池:同一时刻至多 `limit` 个 worker 在跑,worker 本身绝不向外抛出
// (调用方各自 try/catch 把失败落进结果里),这里不需要再兜一层。
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
}

type ReadyEntry = PhotoOriginalUploadEntry & { blob: Blob };

export async function runPhotoOriginalSync(input: {
  albumId: string;
  photoIds: string[];
  serverUploaded: ReadonlySet<string>;
  deps: PhotoOriginalSyncDeps;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ uploaded: number; missingLocal: number }> {
  const { albumId, photoIds, serverUploaded, deps, onProgress } = input;
  const plan = planPhotoOriginalSync(photoIds, serverUploaded);
  const total = plan.length;
  if (total === 0) return { uploaded: 0, missingLocal: 0 };

  // ── 阶段一:逐张确认本机是否还有原图(并发 3)。有 → 攒 entry;无 → 攒 missing。
  const ready: ReadyEntry[] = [];
  const missing: string[] = [];
  let done = 0;
  onProgress?.(done, total);
  await runWithConcurrency(plan, PUT_CONCURRENCY, async (photoId) => {
    try {
      const local = await deps.getCanonicalUploadBlob(photoId);
      if (local) {
        ready.push({ photoId, width: local.width, height: local.height, bytes: local.blob.size, blob: local.blob });
      } else {
        missing.push(photoId);
      }
    } catch {
      // 读本地失败(极少见,比如 IndexedDB 被清):当这张本地缺失处理,下一轮再试。
      missing.push(photoId);
    } finally {
      done += 1;
      onProgress?.(done, total);
    }
  });

  // ── 阶段二:每 50 张一批,sign → put(逐张失败只丢该张,不中断)→ confirm({entries})。
  // 任何一批(sign / confirm 本身)失败都不抛出:这批的 photoId 全部并入 missing,
  // 计入这次运行的结果,下一轮对账差集自动缩小(photoId 幂等)。
  let uploaded = 0;
  for (let i = 0; i < ready.length; i += UPLOAD_BATCH_SIZE) {
    const batch = ready.slice(i, i + UPLOAD_BATCH_SIZE);
    let signed: SignedPhotoOriginalUpload[];
    try {
      signed = await deps.sign(
        albumId,
        batch.map(({ photoId, width, height, bytes }) => ({ photoId, width, height, bytes })),
      );
    } catch {
      for (const entry of batch) missing.push(entry.photoId);
      continue;
    }
    const signedByPhotoId = new Map(signed.map((s) => [s.photoId, s] as const));

    const succeeded: PhotoOriginalUploadEntry[] = [];
    await runWithConcurrency(batch, PUT_CONCURRENCY, async (entry) => {
      const sig = signedByPhotoId.get(entry.photoId);
      if (!sig) {
        // 签名响应没包含这张(理论上不应发生),按缺失处理,不中断其余的。
        missing.push(entry.photoId);
        return;
      }
      try {
        await deps.put(sig.putUrl, entry.blob);
        succeeded.push({ photoId: entry.photoId, width: entry.width, height: entry.height, bytes: entry.bytes });
      } catch {
        missing.push(entry.photoId);
      }
    });

    if (succeeded.length > 0) {
      try {
        await deps.confirm(albumId, { entries: succeeded });
        uploaded += succeeded.length;
      } catch {
        // PUT 已经落到 R2 了,但这批 confirm 没成功 —— 服务端还不知道。不冒领
        // uploaded,并回落进 missing:下一轮对账会用同样的字节重新走一遍
        // sign→put→confirm(photoId 幂等,重复确认无害)。
        for (const entry of succeeded) missing.push(entry.photoId);
      }
    }
  }

  // ── 最后一次性上报本地缺失(genuinely local-absent + 上面各种失败落入的)。
  if (missing.length > 0) {
    try {
      await deps.confirm(albumId, { missing });
    } catch {
      // 吞掉:这次没能把「缺失」计入服务端统计,不影响本次运行结果的真实性 ——
      // 下一轮对账会重新尝试(仍然差集里),runPhotoOriginalSync 本身绝不抛出。
    }
  }

  return { uploaded, missingLocal: missing.length };
}
