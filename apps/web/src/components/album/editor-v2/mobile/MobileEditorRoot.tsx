'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditorRoot —— 移动端这棵树的数据容器。

   副作用(IndexedDB 取照片、blob URL、路由、落库)只住在这里,展示层 MobileEditor
   保持纯组件 → 能被 renderToStaticMarkup 直接断言(仓里没有 jsdom)。

   这里同时是**编辑焦点的持有者**:哪一页在编、选中了哪个槽、面板开着没有。
   这些原本住在展示层,导致弹窗所在的容器层不知道用户在编哪一页 —— 任何页级改动
   都无处可落。焦点上提之后,「改动 → 打进页面 → 落库」才是一条完整的链。

   编辑落地的口径(与桌面刻意不同,见 page-edit.ts):
     · 面板打开时对当前页拍快照(draftBase)+ 记下元素初始样式(textBase)
     · 每次改动都从快照重算,即时打进 pagesState → 那一页重渲(所见)
     · 「完成」才 PATCH(所存);「取消」把快照放回去
   预览与落库共用 page-html-dom 的同一批 patcher,所以所见即所存。

   照片解析口径与桌面一致:屏显用 display 档派生图(不动原图,architecture invariant 1),
   本地没有时回落服务器压缩快照(photo-snapshot §5.3)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { photoStore } from '@/lib/photo/store';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore as _photoStoreForBg } from '@/lib/photo/store';
import { BoardBgSheet } from './modals/BoardBgSheet';
import { ExportMenuModal, CollageModal } from './modals/ExportModals';
import { ShareLinkModal } from './modals/ShareLinkModal';
import { PhotoPickerModal } from './modals/PhotoPickerModal';
import { ElementSheet } from './modals/ElementSheet';
import { TextPanel } from './modals/TextPanel';
import { PageBgPanel } from './modals/PageBgPanel';
import type { Locale } from '@/lib/i18n/routing';
import { collectPhotoIds, type ResolveImage } from '../../adapt-layout';
import { extractPhotoIds, type AlbumDetail, type EditorPage } from '../../types';
import { MobileEditor } from './MobileEditor';
import { MobileToast } from './MobileToast';
import { AiChatSheet } from './modals/AiChatSheet';
import {
  applyPageBg,
  applyTextEdit,
  pageBgPatchBody,
  probeToState,
  readPageBg,
  textPatchBody,
  type SelRect,
  type TextStyleState,
} from './page-edit';
import type { TextHit } from './EditView';
// 样式在容器里引:展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
// token 与桌面共用同一份(共享设计系统,不共享 DOM)。
import '../editor-tokens.css';
import './mobile-editor.css';
// 弹窗借用桌面成品样式(见 modals/ModalHost.tsx)。样式 import 只放容器层 ——
// 展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
import '../editor-port.css';

/** 选中态:哪个槽、框在哪、以及打开面板那一刻它的真实样式(取消要回到这里)。 */
type Selection = { slotId: string; rect: SelRect; base: TextStyleState };

export function MobileEditorRoot({
  detail,
  pages: incomingPages,
  locale,
  onBack,
}: {
  detail: AlbumDetail;
  /** 书页。**由调用方给** —— 真实相册的书住在草稿(authoring)里,那边的 pages
     带 htmlJson(页面真相);detail.pages 走的是没有 html 的旧表,拿不到真相。 */
  pages: EditorPage[];
  locale: Locale;
  /** 顶栏返回。默认回「我的相册」;dev 预览页覆盖它,免得一点就被踢出预览。 */
  onBack?: () => void;
}) {
  const router = useRouter();
  const zh = locale === 'zh';
  // 本地可变副本:编辑即时反映在这里(书立刻变),落库另走 HTTP。
  // 服务端真相变了(草稿重载)→ 以服务端为准整体换掉。
  const [pages, setPages] = useState<EditorPage[]>(incomingPages);
  useEffect(() => setPages(incomingPages), [incomingPages]);

  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  // 缩略档单独取:书册预览栏一条几十页,用主画布的 display 档会拖垮解码与滚动。
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [uploadBgUrl, setUploadBgUrl] = useState<string | null>(null);
  const [bgSheetOpen, setBgSheetOpen] = useState(false);
  // 弹窗开关。行为(导出渲染 / 分享上传)后续接线,这里先让 UI 可开可核对。
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [collageOpen, setCollageOpen] = useState(false);
  const [collageDensity, setCollageDensity] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [pickedPhoto, setPickedPhoto] = useState<string | null>(null);

  // ── 编辑焦点 ──────────────────────────────────────────────────────────────
  const [editPage, setEditPage] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  // 元素编辑 sheet:'text' = 文字,'pagebg' = 页面底色。null = 关。
  const [sheetKind, setSheetKind] = useState<'text' | 'pagebg' | null>(null);
  // mes 的三视图之一:main / font(完整字体列表)。取色器完整版随取色行为一起接。
  const [sheetView, setSheetView] = useState<'main' | 'font'>('main');
  // 面板打开那一刻的整页快照:每次改动都从它重算,取消就是把它放回去。
  const [draftBase, setDraftBase] = useState<EditorPage | null>(null);
  const [textState, setTextState] = useState<TextStyleState | null>(null);
  const [pageBg, setPageBg] = useState<string | null>(null);

  // 未实现功能的统一反馈:点了给一句「即将上线」,不做死按钮。
  const [toast, setToast] = useState<string | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const say = useCallback((label: string) => {
    setToast(label);
    // 3 秒后自动消失(用 setTimeout,与桌面 alert 不同,不阻塞)。
    window.setTimeout(() => setToast((cur) => (cur === label ? null : cur)), 3000);
  }, []);
  const soon = useCallback(
    (what: string, whatEn: string) => say(zh ? `${what}即将上线` : `${whatEn} — coming soon`),
    [say, zh],
  );
  // 画板背景是相册级视觉属性:本地先落地(立刻可见),再 PATCH 持久化(与桌面同一通道)。
  const [boardBgOverride, setBoardBgOverride] = useState<BoardBackground | null | undefined>(
    undefined,
  );

  const photoIds = useMemo(
    () => [
      ...new Set([
        ...extractPhotoIds(detail.album.layoutJson),
        ...collectPhotoIds(
          pages.map((p) => ({ templateId: p.templateId, images: p.imagesJson, texts: p.textsJson })),
        ),
      ]),
    ],
    [detail.album.layoutJson, pages],
  );

  useEffect(() => {
    let cancelled = false;
    void photoStore.getTierUrls(photoIds, 'display').then((urls) => {
      if (!cancelled) setImageUrls(urls);
    });
    void photoStore.getTierUrls(photoIds, 'thumb').then((urls) => {
      if (!cancelled) setThumbUrls(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [photoIds]);

  // ── 落库:与桌面同一通道(PATCH /api/v1/albums/{id}/pages/{index})。 ────────
  // 服务端按同一批 patcher 把改动打进存库 html,前端不重复实现落库侧写回。
  // 内容改动失败必须说话 —— 静默失败会让用户以为改好了,刷新才发现白改。
  const persistPage = useCallback(
    (pageIndex: number, body: Record<string, unknown>) => {
      void fetch(`/api/v1/albums/${detail.album.id}/pages/${pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (!res.ok) say(zh ? '没保存成功,请重试' : "Couldn't save — please retry");
        })
        .catch(() => say(zh ? '没保存成功,请重试' : "Couldn't save — please retry"));
    },
    [detail.album.id, say, zh],
  );

  const closeSheet = () => {
    setSheetKind(null);
    setSheetView('main');
    setDraftBase(null);
    setTextState(null);
  };

  /** 取消:把面板打开那一刻的整页快照放回去(不需要反向撤销)。 */
  const cancelSheet = () => {
    if (draftBase != null && editPage != null) {
      const base = draftBase;
      setPages((prev) => prev.map((p, i) => (i === editPage ? base : p)));
    }
    closeSheet();
  };

  /** 改动即时打进书:总是从快照重算,反复改不累加。 */
  const previewPage = (next: EditorPage) => {
    setPages((prev) => prev.map((p, i) => (i === editPage ? next : p)));
  };

  const openTextSheet = (sel: Selection, page: EditorPage) => {
    setSelection(sel);
    setDraftBase(page);
    setTextState(sel.base);
    setSheetView('main');
    setSheetKind('text');
  };

  const onSelectText = (hit: TextHit) => {
    if (editPage == null) return;
    const page = pages[editPage];
    if (!page) return;
    openTextSheet({ slotId: hit.slotId, rect: hit.rect, base: probeToState(hit.probe) }, page);
  };

  const onTextChange = (patch: Partial<TextStyleState>) => {
    if (!selection || !textState || !draftBase) return;
    const next = { ...textState, ...patch };
    setTextState(next);
    previewPage(applyTextEdit(draftBase, selection.slotId, next, selection.base).page);
  };

  const onTextDone = () => {
    if (!selection || !textState || !draftBase || editPage == null) {
      closeSheet();
      return;
    }
    const { page, props } = applyTextEdit(draftBase, selection.slotId, textState, selection.base);
    previewPage(page);
    persistPage(page.pageIndex, textPatchBody(page, selection.slotId, props));
    closeSheet();
  };

  const openPageBgSheet = () => {
    if (editPage == null) return;
    const page = pages[editPage];
    if (!page) return;
    setDraftBase(page);
    setPageBg(readPageBg(page));
    setSheetView('main');
    setSheetKind('pagebg');
  };

  const onPageBgChange = (color: string | null) => {
    if (!draftBase) return;
    setPageBg(color);
    previewPage(applyPageBg(draftBase, color));
  };

  const onPageBgDone = () => {
    if (!draftBase || editPage == null) {
      closeSheet();
      return;
    }
    const page = applyPageBg(draftBase, pageBg);
    previewPage(page);
    persistPage(page.pageIndex, pageBgPatchBody(pageBg));
    closeSheet();
  };

  // 用户上传的画板底图只存在本地(BoardBackground kind==='upload');取不到就回落无背景。
  const boardBg =
    boardBgOverride !== undefined ? boardBgOverride : (detail.album.boardBackground ?? null);

  const applyBoardBg = (bg: BoardBackground | null) => {
    setBoardBgOverride(bg);
    // 视觉属性,持久化失败静默(下次刷新回退,不打断用户)—— 与桌面同一处置。
    void fetch(`/api/v1/albums/${detail.album.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardBackground: bg }),
    }).catch(() => undefined);
  };

  const uploadBoardBg = (file: File) => {
    const key = `boardbg-${detail.album.id}-${file.size}-${file.name}`;
    void _photoStoreForBg
      .put(key, file)
      .then(() => applyBoardBg({ kind: 'upload', key }))
      .catch(() => undefined);
  };
  useEffect(() => {
    if (boardBg?.kind !== 'upload') {
      setUploadBgUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void photoStore
      .getBlob(boardBg.key)
      .catch(() => undefined)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUploadBgUrl(objectUrl);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [boardBg]);

  const snapshotUrls = useMemo(
    () => detail.album.photoSnapshotUrls ?? {},
    [detail.album.photoSnapshotUrls],
  );
  // 两档都要稳定引用:缩略条按 ctx 引用做 memo,每帧新函数会让整条重渲。
  const resolve: ResolveImage = useCallback(
    (id) => imageUrls[id] ?? snapshotUrls[id],
    [imageUrls, snapshotUrls],
  );
  const resolveThumb: ResolveImage = useCallback(
    (id) => thumbUrls[id] ?? imageUrls[id] ?? snapshotUrls[id],
    [thumbUrls, imageUrls, snapshotUrls],
  );

  const boardBackground =
    boardBg == null
      ? null
      : boardBg.kind === 'color'
        ? boardBg.color
        : boardBg.kind === 'preset'
          ? `center / cover no-repeat url("${presetImageUrl(boardBg.presetId)}")`
          : uploadBgUrl
            ? `center / cover no-repeat url("${uploadBgUrl}")`
            : null;

  return (
    <>
    <MobileEditor
      pages={pages}
      resolve={resolve}
      resolveThumb={resolveThumb}
      boardBackground={boardBackground}
      title={detail.album.title}
      zh={zh}
      onBack={onBack ?? (() => router.push(`/${locale}/my-albums`))}
      editPage={editPage}
      onEnterEdit={(pi) => {
        // 换页 = 换了编辑对象:选中与开着的面板都失效(rect 也不再对得上)。
        if (pi !== editPage) {
          setSelection(null);
          closeSheet();
        }
        setEditPage(pi);
      }}
      onExitEdit={() => {
        setEditPage(null);
        setSelection(null);
        closeSheet();
      }}
      selection={selection}
      sheetOpen={sheetKind != null}
      onSelectText={onSelectText}
      onSelectImage={() => soon('图片编辑', 'Photo editing')}
      onClearSelection={() => {
        // 面板开着时点页面空白不该悄悄取消选中(面板正绑在那个槽上)。
        if (sheetKind == null) setSelection(null);
      }}
      onBoardBg={() => setBgSheetOpen(true)}
      onExport={() => setExportMenuOpen(true)}
      onShare={() => setShareOpen(true)}
      onPageBg={openPageBgSheet}
      onPickImage={() => soon('图片编辑', 'Photo editing')}
      onPickText={() => {
        // 一级栏的「文字」不代表某个具体槽 —— 有选中就把面板叫回来,没选中就告诉
        // 用户怎么选(不做「打开一个不知道在编谁的面板」这种假入口)。
        if (selection && editPage != null && pages[editPage]) {
          openTextSheet(selection, pages[editPage]!);
        } else {
          say(zh ? '点页面上的文字来选中它' : 'Tap the text on the page to select it');
        }
      }}
      onMore={() => soon('「更多」', 'More')}
      onOpenChat={() => setAiChatOpen(true)}
      onDeletePage={() => soon('删除页面', 'Delete page')}
    />
    <BoardBgSheet
      open={bgSheetOpen}
      zh={zh}
      current={boardBg}
      onClose={() => setBgSheetOpen(false)}
      onPick={(bg) => {
        applyBoardBg(bg);
        setBgSheetOpen(false);
      }}
      onUpload={(f) => {
        uploadBoardBg(f);
        setBgSheetOpen(false);
      }}
    />
    <ExportMenuModal
      open={exportMenuOpen}
      zh={zh}
      onClose={() => setExportMenuOpen(false)}
      onCollage={() => {
        setExportMenuOpen(false);
        setCollageOpen(true);
      }}
    />
    <CollageModal
      open={collageOpen}
      zh={zh}
      spreadCount={Math.max(0, Math.ceil(pages.length / 2))}
      density={collageDensity}
      onPickDensity={setCollageDensity}
      onClose={() => setCollageOpen(false)}
      onConfirm={() => {
        setCollageOpen(false);
        soon('拼图导出', 'Collage export');
      }}
    />
    <ShareLinkModal
      open={shareOpen}
      zh={zh}
      link={null}
      onConfirm={() => {
        setShareOpen(false);
        soon('分享链接', 'Share links');
      }}
      onCopy={() => soon('分享链接', 'Share links')}
      onClose={() => setShareOpen(false)}
    />
    <PhotoPickerModal
      open={photoPickerOpen}
      zh={zh}
      subtitle={zh ? '选一张替换当前图槽的照片。' : 'Pick a photo to replace this slot.'}
      photos={photoIds.map((id) => ({ id, url: thumbUrls[id] ?? imageUrls[id] }))}
      selectedId={pickedPhoto}
      onSelect={setPickedPhoto}
      onConfirm={() => {
        setPhotoPickerOpen(false);
        setPickedPhoto(null);
        soon('换照片', 'Photo swap');
      }}
      onClose={() => {
        setPhotoPickerOpen(false);
        setPickedPhoto(null);
      }}
    />
    {sheetKind != null && (
      <ElementSheet
        open
        zh={zh}
        title={
          sheetView === 'font'
            ? zh ? '字体' : 'Font'
            : sheetKind === 'text'
              ? zh ? '文字' : 'Text'
              : zh ? '书页背景' : 'Page background'
        }
        onCancel={cancelSheet}
        onDone={sheetKind === 'text' ? onTextDone : onPageBgDone}
      >
        {sheetKind === 'text' && textState != null ? (
          <TextPanel
            zh={zh}
            view={sheetView}
            state={textState}
            onChange={onTextChange}
            onOpenFontList={() => setSheetView('font')}
            onBackToMain={() => setSheetView('main')}
            onMoreColors={() => soon('完整取色器', 'Full color picker')}
          />
        ) : (
          <PageBgPanel zh={zh} value={pageBg} onChange={onPageBgChange} />
        )}
      </ElementSheet>
    )}
    <AiChatSheet
      open={aiChatOpen}
      zh={zh}
      onClose={() => setAiChatOpen(false)}
      onSend={() => soon('AI 对话', 'AI chat')}
    />
    <MobileToast text={toast} />
    </>
  );
}
