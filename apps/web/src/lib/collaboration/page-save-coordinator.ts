import type { ImagePos } from '@yujee/contracts';

// 页面保存协调器(collab plan §9):桌面/移动端共用的单页 PATCH 队列。
//
// 对外保证的队列规则(§9.2,逐条有测试):
//  1. 不同页面可并发保存;
//  2. 同一页面永远只有一个在途请求;
//  3. 在途期间的新修改合并进下一批 patch(见 mergePagePatch);
//  4. 成功响应的 version 成为下一批的 baseVersion;
//  5. 409 → conflict,该页停止自动提交(等待用户选择重载/放弃);
//  6. 网络失败 → failed,patch 保留,flush() 重试;
//  7. 切页不丢队列;离开编辑器前尽力 flush,正确性不依赖 beforeunload;
//  8. 禁止静默吞错 —— 状态变化一律经 onPageStateChange 上报;
//  9. 401/403 → forbidden,与可重试的网络失败分开,停止自动重试;
// 10. dispose 后不再发送、不再更新状态。
//
// 传输层依赖注入(测试用假 transport,编辑器注入真 fetch)。不做 debounce:
// 调用方(编辑器)已有自己的节流口径,协调器只管顺序与状态。

export type PagePatch = {
  imagesJson?: Record<string, string>;
  textsJson?: Record<string, string>;
  imagePosJson?: Record<string, ImagePos>;
  textStyles?: Record<string, Record<string, string | null>>;
  pageStyle?: Record<string, string | null>;
};

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'failed' | 'forbidden';

export type ConflictInfo = {
  pageIndex: number;
  /** 服务端当前页 version;重新加载时它应成为新的本地 version。 */
  currentVersion: number;
};

/** 传输结果三态:成功 / 版本冲突 / 传输失败(网络 vs 无权限分开)。 */
export type SaveOutcome =
  | { ok: true; version: number | null; revision: number | null }
  | { ok: 'conflict'; currentVersion: number }
  | { ok: 'error'; kind: 'network' | 'forbidden' };

export type SaveTransport = {
  /** baseVersion 为 null 表示 legacy 相册(页面无 version):传输层不得携带
   *  baseVersion,服务端走阶段 A 的 owner 盲写;响应也不带回 version。 */
  save(pageIndex: number, baseVersion: number | null, patch: PagePatch): Promise<SaveOutcome>;
};

export type PageSaveCoordinator = {
  /** baseVersion:页面当前 version;legacy 相册(无 version)传 null。 */
  enqueue(pageIndex: number, baseVersion: number | null, patch: PagePatch): void;
  flush(pageIndex?: number): Promise<void>;
  state(pageIndex: number): SaveState;
  /** 冲突后服务端告知的当前版本(「重新加载」流程的输入);无冲突返回 null。 */
  conflictInfo(pageIndex: number): ConflictInfo | null;
  /** 用户放弃本地修改、以服务端状态为准后调用:清队列回到 saved 口径。 */
  resolveConflict(pageIndex: number, serverVersion: number): void;
  dispose(): void;
};

type PageSlot = {
  state: SaveState;
  /** 等待发送(或冲突后保留)的未提交改动;null = 无积压。 */
  pending: PagePatch | null;
  /** 下一次请求要带的 baseVersion;成功后由响应 version 推进。null = legacy
   *  盲写(阶段 A 的 owner 旧路径),不做版本串接。 */
  baseVersion: number | null;
  inFlight: boolean;
  conflict: ConflictInfo | null;
};

export function createPageSaveCoordinator(opts: {
  transport: SaveTransport;
  onPageStateChange?: (pageIndex: number, state: SaveState) => void;
  onConflict?: (info: ConflictInfo) => void;
}): PageSaveCoordinator {
  const slots = new Map<number, PageSlot>();
  let disposed = false;

  function slotOf(pageIndex: number): PageSlot {
    let slot = slots.get(pageIndex);
    if (!slot) {
      slot = { state: 'idle', pending: null, baseVersion: 0, inFlight: false, conflict: null };
      slots.set(pageIndex, slot);
    }
    return slot;
  }

  function setState(pageIndex: number, slot: PageSlot, state: SaveState) {
    if (slot.state === state) return;
    slot.state = state;
    if (!disposed) opts.onPageStateChange?.(pageIndex, state);
  }

  async function pump(pageIndex: number, slot: PageSlot): Promise<void> {
    if (disposed || slot.inFlight) return;
    // conflict/forbidden 是终态:停止自动提交,等 resolveConflict 或 dispose。
    if (slot.state === 'conflict' || slot.state === 'forbidden') return;
    if (!slot.pending) return;

    slot.inFlight = true;
    setState(pageIndex, slot, 'saving');
    const patch = slot.pending;
    const baseVersion = slot.baseVersion;
    let outcome: SaveOutcome;
    try {
      outcome = await opts.transport.save(pageIndex, baseVersion, patch);
    } catch {
      outcome = { ok: 'error', kind: 'network' };
    } finally {
      slot.inFlight = false;
    }

    if (disposed) return; // dispose 后不更新状态(§9.2 规则 10)

    if (outcome.ok === true) {
      // 规则 4:成功响应的 version 是下一批的 baseVersion(legacy 盲写响应无
      // version → 维持 null,不做串接)。
      slot.baseVersion = outcome.version ?? slot.baseVersion;
      if (slot.pending === patch) {
        // 在途期间没有新编辑:这批就是全部,清空积压。
        slot.pending = null;
        setState(pageIndex, slot, 'saved');
      } else {
        // 在途期间有新编辑(规则 3 已合并进 pending):继续发下一批。
        setState(pageIndex, slot, 'dirty');
        void pump(pageIndex, slot);
      }
      return;
    }

    if (outcome.ok === 'conflict') {
      // 规则 5:保留未提交 patch(用户可选放弃),停止自动重试。
      slot.conflict = { pageIndex, currentVersion: outcome.currentVersion };
      setState(pageIndex, slot, 'conflict');
      opts.onConflict?.(slot.conflict);
      return;
    }

    if (outcome.kind === 'forbidden') {
      // 规则 9:401/403 与网络失败分开;停止自动重试,patch 保留在本地。
      setState(pageIndex, slot, 'forbidden');
      return;
    }

    // 规则 6:网络失败,patch 保留,允许用户重试(flush 会再泵一次)。
    setState(pageIndex, slot, 'failed');
  }

  return {
    enqueue(pageIndex, baseVersion, patch) {
      if (disposed) return;
      const slot = slotOf(pageIndex);
      // 调用方给的 baseVersion 是「本地现在看到的版本」。若协调器已知更新的
      // 版本(刚保存成功),以已知新版本为准 —— 否则下一笔编辑必然 409。
      // null(legacy)只允许从 null 抬到数字,不许反向回退。
      if (baseVersion !== null && (slot.baseVersion === null || baseVersion > slot.baseVersion)) {
        slot.baseVersion = baseVersion;
      }
      slot.pending = slot.pending ? mergePagePatch(slot.pending, patch) : patch;
      setState(pageIndex, slot, 'dirty');
      void pump(pageIndex, slot);
    },

    async flush(pageIndex) {
      const targets =
        pageIndex === undefined ? [...slots.entries()] : [[pageIndex, slotOf(pageIndex)] as const];
      // 等每个目标页的「在途 + 积压」都清空(或进入终态)。failed 也会被重泵
      // (规则 6:flush = 用户点了重试);conflict/forbidden 不重发。
      await Promise.all(
        targets.map(async ([index, slot]) => {
          for (let guard = 0; guard < 100; guard += 1) {
            if (slot.state === 'conflict' || slot.state === 'forbidden') return;
            if (!slot.inFlight && !slot.pending) return;
            void pump(index, slot);
            // 等在途请求落定:微任务轮询足够(transport 是纯 Promise)。
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }),
      );
    },

    state(pageIndex) {
      return slots.get(pageIndex)?.state ?? 'idle';
    },

    conflictInfo(pageIndex) {
      return slots.get(pageIndex)?.conflict ?? null;
    },

    resolveConflict(pageIndex, serverVersion) {
      const slot = slots.get(pageIndex);
      if (!slot) return;
      slot.pending = null;
      slot.conflict = null;
      slot.baseVersion = serverVersion;
      setState(pageIndex, slot, 'saved');
    },

    dispose() {
      disposed = true;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mergePagePatch:同页两笔 patch 的合并语义(在途期间的新修改并入下一批)。
// 这是协调器里唯一有产品取舍的纯函数 —— 见 page-save-coordinator.test.ts
// 的「合并语义」用例组。
// ─────────────────────────────────────────────────────────────────────────────
export type PagePatchMerger = (pending: PagePatch, next: PagePatch) => PagePatch;

// 合并语义(为什么必须合并,而不是覆盖):
//   服务端 updatePage 对每个提供的顶层字段做**整体替换**(page.texts =
//   patch.textsJson,§8.2)。所以「先改了标题,还没发出去,又改了正文」如果只发
//   后一笔 {body},标题那笔会被服务端的整体替换抹掉 —— 合并必须把两笔的意图
//   都带上。
//
//   1. 五个顶层字段(textsJson/imagesJson/imagePosJson/textStyles/pageStyle)
//      谁在任一笔出现过,结果里就出现;两边都没出现的字段,结果里也没有
//      (字段缺失 = 「不改」,服务端保持现值,§8.2)。
//   2. 字段内部按 key 合并:同 key 后写覆盖先写(含 textStyles 里 null = 移除
//      样式这种「用 null 表达的写操作」,null 也要能覆盖非 null);不同 key 并存。
//   3. 纯函数:展开构造新对象,绝不原地修改入参(协调器在异步泵里复用它们)。
export const mergePagePatch: PagePatchMerger = (pending, next) => {
  const merged: PagePatch = {};
  if (pending.textsJson !== undefined || next.textsJson !== undefined) {
    merged.textsJson = { ...pending.textsJson, ...next.textsJson };
  }
  if (pending.imagesJson !== undefined || next.imagesJson !== undefined) {
    merged.imagesJson = { ...pending.imagesJson, ...next.imagesJson };
  }
  if (pending.imagePosJson !== undefined || next.imagePosJson !== undefined) {
    merged.imagePosJson = { ...pending.imagePosJson, ...next.imagePosJson };
  }
  if (pending.textStyles !== undefined || next.textStyles !== undefined) {
    // textStyles 是两层结构:slot → {css属性: 值|null}。slot 级后写覆盖,但两边
    // 都写过的 slot 要**属性级**合并 —— 服务端 patchHtmlTextStyle 按属性逐个
    // 应用(null=移除该属性),「先加粗+红 → 再移除加粗」的意图是保留红、只去
    // 加粗;slot 级整体替换会把红一起丢掉。
    const slots: Record<string, Record<string, string | null>> = {
      ...pending.textStyles,
      ...next.textStyles,
    };
    for (const slot of Object.keys(pending.textStyles ?? {})) {
      const earlier = pending.textStyles![slot]!;
      const later = next.textStyles?.[slot];
      if (later) slots[slot] = { ...earlier, ...later };
    }
    merged.textStyles = slots;
  }
  if (pending.pageStyle !== undefined || next.pageStyle !== undefined) {
    merged.pageStyle = { ...pending.pageStyle, ...next.pageStyle };
  }
  return merged;
};
