'use client';

/* ════════════════════════════════════════════════════════════════════════════
   use-chat-coordinator —— 让桌面 ChatPanel 原样挂进移动树的协调器实现。

   移动端曾为「成书后的对话」另做一个瘦弹窗(AiChatSheet):没有加照片、没有采访、
   样式另一套,与生成阶段的完整对话弹窗长成两个东西(2026-08-03 用户明确否掉)。
   统一的做法不是把 ChatPanel 抄一份,而是把它依赖的 ChatCoordinator 接口对着
   移动树的 React 状态实现一遍 —— ChatPanel 一行不改,两个阶段共用同一个弹窗。

   实现口径:
   · 全部函数经 depsRef 在调用时取最新值(与桌面「never cache a coordinator fn」
     同一纪律,只是方向相反:这里是协调器自己不缓存 React 状态)。
   · ChatPanel 在成书相册上真正会调的只有九个:ready / getPagesState /
     goToChapterById / imageUrl / replacePages / coverOptionHTML /
     setExportGateUi / exportPdf / authoringFocusPageIndex。
   · 其余五个是 draft-edit(已退役,见 ChatPanel 的 `void runDraftEditTurn`)或
     EditorBook 内部专用(applyAuthoringPatch 的包装在 ChatPanel 里是死代码),
     按「诚实降级」实现:纯读的给出正确值,写类的返回「没应用」,截图直接抛错 ——
     谁复活了旧链路谁第一时间看见。
   ════════════════════════════════════════════════════════════════════════════ */

import { useRef } from 'react';
import { getTemplate } from '@yujee/contracts/templates';

import { isDefaultPageBackground } from '@/lib/design/page-backgrounds';
import type { DraftSkeleton } from '@/lib/album/authoring-client';

import type { ChatCoordinator } from '../editor-coordinator';
import { pageFaceHTML } from '../page-face';
import { patchHtmlPageStyle } from '../../page-html-dom';
import type { ResolveImage } from '../../adapt-layout';
import type { EditorPage } from '../../types';

export type MobileChatDeps = {
  pages: EditorPage[];
  /** 正在编辑的页(null = 浏览态)。设计对话按它定位「当前页」。 */
  editPage: number | null;
  draftChapters: DraftSkeleton | null;
  resolve: ResolveImage;
  /** 设计对话 committed:整书原地替换(已重编号)。 */
  replacePages: (pages: EditorPage[]) => void;
  /** 画板跳到某一页所在的屏(聊天里的章节卡/采访推进用)。 */
  goToPage: (pageIndex: number) => void;
  setExportGateLocked: (locked: boolean) => void;
  exportPdf: () => Promise<void>;
};

/** 模板的主图槽(第一个声明的图槽),与桌面 heroSlotId 同口径。 */
function heroSlotId(templateId: string): string {
  return getTemplate(templateId)?.images?.[0]?.id ?? 'image';
}

/** 纯构造器(不含 React),单测直接喂假 deps。 */
export function createChatCoordinator(deps: () => MobileChatDeps): ChatCoordinator {
  return {
    ready: true,
    goToChapterById: (chapterId) => {
      const d = deps();
      // 与桌面同一判据:骨架里这一章的第一页(skeleton pages 带 chapterId)。
      const pageIdx = d.draftChapters?.pages.find((p) => p.chapterId === chapterId)?.pageIndex;
      if (pageIdx != null) d.goToPage(pageIdx);
    },
    goToPageIndex: (pageIndex) => deps().goToPage(pageIndex),
    // draft-edit 遗留接口:ChatPanel 里的调用方已退役(applyAuthoringPatch 的包装是
    // 死代码,applyDraftAct/capturePageRender 只被 `void runDraftEditTurn` 引用)。
    applyAuthoringPatch: () => false,
    applyDraftAct: () => ({}),
    capturePageRender: () => {
      return Promise.reject(new Error('draft-edit capture is not wired on mobile'));
    },
    capturePhotoThumb: async () => undefined,
    replacePages: (pages) => {
      if (pages.length === 0) return false;
      // pageIndex 按数组位置重编号,不信来料字段(与桌面 replacePages 同一条边界防御,
      // 见 EditorPort 里 2026-08-03 挪页错乱的根因注释)。
      deps().replacePages(
        pages.map((p, i) => ({
          pageIndex: i,
          templateId: p.templateId,
          imagesJson: { ...p.imagesJson },
          textsJson: { ...p.textsJson },
          imagePosJson: { ...(p.imagePosJson ?? {}) },
          htmlJson: p.htmlJson,
        })),
      );
      return true;
    },
    getPagesState: () => deps().pages,
    // 浏览态没有「选中页」概念,回落到第 0 页(桌面回落到当前跨页首页;移动浏览态
    // 的游标住在展示层,设计对话对整本书说话时 currentPageIndex 本就只是提示)。
    authoringFocusPageIndex: () => deps().editPage ?? 0,
    coverOptionHTML: (templateId, photoId, boxW = 132, boxH = 176, pageBackground) => {
      const d = deps();
      const page: EditorPage = {
        pageIndex: 0,
        templateId,
        imagesJson: photoId ? { [heroSlotId(templateId)]: photoId } : {},
        textsJson: {},
      };
      // 合成页不在书里,没有展示层页签(桌面同款:indexOf 未命中 → folio null)。
      const html = pageFaceHTML(page, boxW, boxH, {
        folio: null,
        folioSide: 'right',
        total: d.pages.length,
        resolve: d.resolve,
      });
      if (pageBackground && !isDefaultPageBackground(pageBackground)) {
        return patchHtmlPageStyle(html, { 'background-color': pageBackground }) ?? html;
      }
      return html;
    },
    bookPhotoIds: () => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of deps().pages) {
        for (const id of Object.values(p.imagesJson)) {
          if (id && !seen.has(id)) {
            seen.add(id);
            out.push(id);
          }
        }
      }
      return out;
    },
    imageUrl: (id) => deps().resolve(id),
    // 滤镜重载是 EditorBook 的画布内务;移动树的 URL 重建由 photoFilter effect 自动做。
    reloadPhotoFilter: async () => {},
    setExportGateUi: (locked) => deps().setExportGateLocked(locked),
    exportPdf: () => deps().exportPdf(),
  };
}

/** ChatPanel 要的是 RefObject<ChatCoordinator|null>;首帧就得有值(它的挂载引擎
 *  只跑一次,晚了不补)。渲染期惰性初始化,闭包读 depsRef → 永远是最新状态。 */
export function useChatCoordinator(deps: MobileChatDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const coordinator = useRef<ChatCoordinator | null>(null);
  if (coordinator.current === null) {
    coordinator.current = createChatCoordinator(() => depsRef.current);
  }
  return coordinator;
}
