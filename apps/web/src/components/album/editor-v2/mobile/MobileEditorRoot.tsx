'use client';

/* ════════════════════════════════════════════════════════════════════════════
   MobileEditorRoot —— 移动端这棵树的数据容器。

   副作用(IndexedDB 取照片、blob URL、路由)只住在这里,展示层 MobileEditor 保持
   纯组件 → 能被 renderToStaticMarkup 直接断言(仓里没有 jsdom)。

   照片解析口径与桌面一致:屏显用 display 档派生图(不动原图,architecture invariant 1),
   本地没有时回落服务器压缩快照(photo-snapshot §5.3)。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { photoStore } from '@/lib/photo/store';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore as _photoStoreForBg } from '@/lib/photo/store';
import { BoardBgSheet } from './modals/BoardBgSheet';
import { ExportMenuModal, CollageModal, ExportProgressModal, ExportFailModal } from './modals/ExportModals';
import { ShareLinkModal } from './modals/ShareLinkModal';
import { PhotoPickerModal } from './modals/PhotoPickerModal';
import { ElementSheet } from './modals/ElementSheet';
import { TextPanel, type TextStyleState } from './modals/TextPanel';
import { PageBgPanel } from './modals/PageBgPanel';
import type { Locale } from '@/lib/i18n/routing';
import { collectPhotoIds, type ResolveImage } from '../../adapt-layout';
import { extractPhotoIds, type AlbumDetail } from '../../types';
import { MobileEditor } from './MobileEditor';
// 样式在容器里引:展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
// token 与桌面共用同一份(共享设计系统,不共享 DOM)。
import '../editor-tokens.css';
import './mobile-editor.css';
// 弹窗借用桌面成品样式(见 modals/ModalHost.tsx)。样式 import 只放容器层 ——
// 展示层保持无副作用 import,才能在 node 测试里直接渲染断言。
import '../editor-port.css';

export function MobileEditorRoot({
  detail,
  locale,
  onBack,
}: {
  detail: AlbumDetail;
  locale: Locale;
  /** 顶栏返回。默认回「我的相册」;dev 预览页覆盖它,免得一点就被踢出预览。 */
  onBack?: () => void;
}) {
  const router = useRouter();
  const pages = detail.pages;
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
  // 元素编辑 sheet:'text' = 文字,'pagebg' = 页面底色。null = 关。
  const [sheetKind, setSheetKind] = useState<'text' | 'pagebg' | null>(null);
  // mes 的三视图之一:main / font(完整字体列表)。取色器完整版随取色行为一起接。
  const [sheetView, setSheetView] = useState<'main' | 'font'>('main');
  const [textState, setTextState] = useState<TextStyleState>({
    text: '',
    fontSize: null,
    fontId: null,
    color: null,
    bold: false,
    italic: false,
    align: null,
  });
  const [pageBg, setPageBg] = useState<string | null>(null);
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
      onBack={onBack ?? (() => router.push(`/${locale}/my-albums`))}
      onBoardBg={() => setBgSheetOpen(true)}
      onExport={() => setExportMenuOpen(true)}
      onShare={() => setShareOpen(true)}
      onPageBg={() => setSheetKind('pagebg')}
      onPickImage={() => setPhotoPickerOpen(true)}
      onPickText={() => setSheetKind('text')}
    />
    <BoardBgSheet
      open={bgSheetOpen}
      zh={locale === 'zh'}
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
      zh={locale === 'zh'}
      onClose={() => setExportMenuOpen(false)}
      onCollage={() => {
        setExportMenuOpen(false);
        setCollageOpen(true);
      }}
    />
    <CollageModal
      open={collageOpen}
      zh={locale === 'zh'}
      spreadCount={Math.max(0, Math.ceil(pages.length / 2))}
      density={collageDensity}
      onPickDensity={setCollageDensity}
      onClose={() => setCollageOpen(false)}
    />
    <ShareLinkModal
      open={shareOpen}
      zh={locale === 'zh'}
      link={null}
      onClose={() => setShareOpen(false)}
    />
    <PhotoPickerModal
      open={photoPickerOpen}
      zh={locale === 'zh'}
      subtitle={locale === 'zh' ? '选一张替换当前图槽的照片。' : 'Pick a photo to replace this slot.'}
      photos={photoIds.map((id) => ({ id, url: thumbUrls[id] ?? imageUrls[id] }))}
      selectedId={pickedPhoto}
      onSelect={setPickedPhoto}
      onClose={() => {
        setPhotoPickerOpen(false);
        setPickedPhoto(null);
      }}
    />
    {sheetKind != null && (
      <ElementSheet
        open
        zh={locale === 'zh'}
        title={
          sheetView === 'font'
            ? locale === 'zh' ? '字体' : 'Font'
            : sheetKind === 'text'
              ? locale === 'zh' ? '文字' : 'Text'
              : locale === 'zh' ? '书页背景' : 'Page background'
        }
        onCancel={() => {
          setSheetKind(null);
          setSheetView('main');
        }}
        onDone={() => {
          // 落库随「先选中再编辑」的选中链路一起接;此处先收起面板。
          setSheetKind(null);
          setSheetView('main');
        }}
      >
        {sheetKind === 'text' ? (
          <TextPanel
            zh={locale === 'zh'}
            view={sheetView}
            state={textState}
            onChange={(patch) => setTextState((cur) => ({ ...cur, ...patch }))}
            onOpenFontList={() => setSheetView('font')}
            onBackToMain={() => setSheetView('main')}
          />
        ) : (
          <PageBgPanel zh={locale === 'zh'} value={pageBg} onChange={setPageBg} />
        )}
      </ElementSheet>
    )}
    </>
  );
}
