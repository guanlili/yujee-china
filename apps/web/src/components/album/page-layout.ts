import { getTemplate } from '@yujee/contracts/templates';
import { isSpreadTemplate } from '@yujee/contracts/render/page-box';

// 左右页配对的**唯一**走查(#303)。此前 spreads.ts 与 page-html-dom.ts 各写了一份
// 同样的配对逻辑,双份真相 —— 跨页一进来两边都得改且极易漂移,故收敛到这里。
// 版面模型:cover 单独起右页(recto),ending 单独收左页(verso);其余 interior+toc
// 顺序两两配;spread 模板独占一整个跨页(side='both')。
// 未处理:模板契约里的 TemplatePairing(`forced`/`with`/`side`)——某内页要求与
// 指定邻页强制配对/占固定侧——目前这里完全不看,仍按顺序两两配。

export type PageSide = 'left' | 'right' | 'both';

export interface PagePlacement {
  /** 该页落在第几个物理跨页上(从 0 起)。 */
  spreadIndex: number;
  /** 占跨页的哪一侧;'both' = 双宽模板占满整个跨页。 */
  side: PageSide;
}

function isSolo(templateId: string): 'cover' | 'ending' | null {
  const category = getTemplate(templateId)?.category;
  if (category === 'cover') return 'cover';
  if (category === 'ending') return 'ending';
  return null;
}

export function placePages(templateIds: string[]): PagePlacement[] {
  const out: PagePlacement[] = [];
  let spreadIndex = 0;
  // 已经占了当前跨页左半、还等着右半来配的页;null = 当前跨页还空着。
  let pendingLeft = false;

  const closePending = () => {
    if (pendingLeft) {
      spreadIndex += 1;
      pendingLeft = false;
    }
  };

  for (const templateId of templateIds) {
    const solo = isSolo(templateId);
    if (solo) {
      closePending();
      out.push({ spreadIndex, side: solo === 'cover' ? 'right' : 'left' });
      spreadIndex += 1;
      continue;
    }
    // 双宽模板要独占一整个跨页。若当前跨页已被上一页占了左半,先把那个跨页收掉
    // (它的右半留空),否则双宽页会被当成右半塞进去 —— 整本从这里开始错位。
    if (isSpreadTemplate(templateId)) {
      closePending();
      out.push({ spreadIndex, side: 'both' });
      spreadIndex += 1;
      continue;
    }
    if (!pendingLeft) {
      out.push({ spreadIndex, side: 'left' });
      pendingLeft = true;
    } else {
      out.push({ spreadIndex, side: 'right' });
      spreadIndex += 1;
      pendingLeft = false;
    }
  }

  return out;
}
