/* 移动端顶栏「返回」该去哪 —— 纯函数,零 DOM(能被 node 直接测)。

   浏览态那个返回键此前没接来处:EditorPort 挂 MobileEditorRoot 时不传 onBack,
   于是一律 router.push('/{locale}/my-albums')。从相册预览/分享页点进来的人,返回
   被硬拽去相册列表,而不是回上一页。

   反过来无脑 router.back() 也不行:直接粘 URL、新标签页打开、或从站外跳进来时,
   back() 会把人踢出站(甚至回到搜索结果页)。所以按来处判:同源来处才回退,
   否则落到相册列表这个安全落点。 */

export type BackTarget = 'history' | 'albums';

/**
 * @param referrer document.referrer(无来处时是空串)
 * @param origin   window.location.origin
 */
export function resolveBackTarget(referrer: string, origin: string): BackTarget {
  if (!referrer || !origin) return 'albums';
  let refOrigin: string;
  try {
    refOrigin = new URL(referrer).origin;
  } catch {
    // referrer 不是合法 URL(极少见,但别让返回键因此炸掉)
    return 'albums';
  }
  return refOrigin === origin ? 'history' : 'albums';
}
