/* 换图用的本册照片选择器。

   点一张就直接换、直接关 —— 不做「选中 + 完成」两步:换图是可逆的(再点一张就换回来),
   为一个可逆动作加一道确认只是多一次点击。所以这里不复用 ElementSheet(那是带
   取消/完成语义的宿主)。

   照片来源是本册已传的那些(photoStore 本地已有缩略图,不走上传链路)。 */

import type { ReactNode } from 'react';

export type PhotoPickerSheetProps = {
  open: boolean;
  zh: boolean;
  /** 本册全部照片 id(顺序即展示顺序)。 */
  photoIds: readonly string[];
  /** photoId → 缩略图 URL。取不到的那张仍然渲染占位格,不静默消失。 */
  urls: Record<string, string>;
  /** 当前图槽用的那张:打勾标出来,点它等于不换。 */
  currentPhotoId?: string | null;
  onPick: (photoId: string) => void;
  onClose: () => void;
};

export function PhotoPickerSheet({
  open,
  zh,
  photoIds,
  urls,
  currentPhotoId,
  onPick,
  onClose,
}: PhotoPickerSheetProps): ReactNode {
  if (!open) return null;
  return (
    // **必须套这层宿主**:.mes-* 那套样式借用桌面成品(定义在 editor-port.css),
    // 选择器带 .editor-port 祖先。漏了它样式一条都不命中 —— 遮罩、卡片底、定位全没,
    // 照片网格会裸奔铺满整屏盖住画布(真机上抓到过)。结构与 ElementSheet 逐层对齐。
    <div className="editor-port mobile-modal-host">
      <div className="mes-overlay" data-open="1" onClick={onClose}>
        <div className="mes-card mpick-card" onClick={(e) => e.stopPropagation()}>
          <div className="mes-grab" aria-hidden="true">
            <span />
          </div>
          <div className="mes-head">
            <button type="button" className="mes-cancel" onClick={onClose}>
              {zh ? '取消' : 'Cancel'}
            </button>
            <div className="mes-title">{zh ? '换一张' : 'Replace photo'}</div>
            {/* 右侧留空占位:头部是三栏栅格,少一栏标题就不居中了。 */}
            <span className="mes-hbtn" aria-hidden="true" />
          </div>
          <div className="mes-body">
            {photoIds.length === 0 ? (
              <div className="mpick-empty">
                {zh ? '这本相册还没有照片' : 'No photos in this album yet'}
              </div>
            ) : (
              <div className="mpick-grid">
                {photoIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="mpick-cell"
                    data-active={id === currentPhotoId ? '1' : undefined}
                    aria-label={zh ? '用这张' : 'Use this photo'}
                    onClick={() => onPick(id)}
                  >
                    {urls[id] ? (
                      // 本地 blob URL,不过 next/image(那条路会把 blob 当远端域名拒掉)。
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urls[id]} alt="" loading="lazy" />
                    ) : (
                      <span className="mpick-ph" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
