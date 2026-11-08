/* 换图用的本册照片选择器。

   点一张就直接换、直接关 —— 不做「选中 + 完成」两步:换图是可逆的(再点一张就换回来),
   为一个可逆动作加一道确认只是多一次点击。所以这里不复用 ElementSheet(那是带
   取消/完成语义的宿主)。

   照片来源是本册已传的那些(photoStore 本地已有缩略图,不走上传链路)。
   2026-11-08: 补了「从手机相册选一张」—— 手机用户的照片本来就在相册里,
   只能从「本册已有」里挑的话,想换一张新图就无路可走。上传链路(压缩入库 →
   备份档上云 → 换图 PATCH)由调用方负责,这里只负责把文件交出去。 */

import type { ReactNode } from 'react';
import type { AT } from '@/lib/i18n/pick';
import { IMAGE_INPUT_ACCEPT } from '@/lib/photo/heic';

export type PhotoPickerSheetProps = {
  open: boolean;
  aT: AT;
  /** 本册全部照片 id(顺序即展示顺序)。 */
  photoIds: readonly string[];
  /** photoId → 缩略图 URL。取不到的那张仍然渲染占位格,不静默消失。 */
  urls: Record<string, string>;
  /** 当前图槽用的那张:打勾标出来,点它等于不换。 */
  currentPhotoId?: string | null;
  onPick: (photoId: string) => void;
  onClose: () => void;
  /** 从手机相册选一张**新**照片。调用方负责压缩入库 → 备份上云 → 换图。 */
  onUpload?: (file: File) => void;
};

export function PhotoPickerSheet({
  open,
  aT,
  photoIds,
  urls,
  currentPhotoId,
  onPick,
  onClose,
  onUpload,
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
              {aT('取消', 'Cancel')}
            </button>
            <div className="mes-title">{aT('换一张', 'Replace photo')}</div>
            {/* 右侧留空占位:头部是三栏栅格,少一栏标题就不居中了。 */}
            <span className="mes-hbtn" aria-hidden="true" />
          </div>
          <div className="mes-body">
            {photoIds.length === 0 && !onUpload ? (
              <div className="mpick-empty">
                {aT('这本相册还没有照片', 'No photos in this album yet')}
              </div>
            ) : (
              <div className="mpick-grid">
                {/* 从相册选新图放第一位:手机用户最先要的是「用我手机里的照片」 */}
                {onUpload && (
                  <label className="mpick-cell mpick-upload">
                    <input
                      type="file"
                      accept={IMAGE_INPUT_ACCEPT}
                      className="hidden"
                      aria-label={aT('从相册选一张', 'Choose from your album')}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUpload(f);
                        e.target.value = ''; // 同一张图可以再选一次
                      }}
                    />
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>{aT('从相册选一张', 'From your album')}</span>
                  </label>
                )}
                {photoIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="mpick-cell"
                    data-active={id === currentPhotoId ? '1' : undefined}
                    aria-label={aT('用这张', 'Use this photo')}
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
