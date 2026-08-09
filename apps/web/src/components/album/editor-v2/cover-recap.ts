// 封面回执卡(「已选的封面与封底」)的两块纯逻辑,从 ChatPanel 那个巨大的命令式
// effect 里拆出来:那里没有 jsdom 夹具,留在里面就只能靠 source-text 断言守，
// 而这两块恰恰是评审踩到的两个坑,必须能被真断言钉住。
//
//  · coverPreviewBackground:预览该用哪个底色(第三套走 colorway,其余走书页底色);
//  · coverRecapFromPages:从真页面反推回执卡要的模板/照片/文案/底色。
import { coverColorwayById } from '@/lib/design/third-set-palette';

/**
 * 封面预览底色的唯一口径。
 *
 * 第三套(mag-62)自带的 pageBackground 是近白的 #F1F2F0 —— 那是**内页**底色,
 * 盖到 mag-62 深色页根上就等于把整张封面刷成浅色:粉标题掉到 1.7:1、米白小字
 * ~1.05:1,预览近乎一片空白。深色套的封面必须用它自己 colorway 的底色渲染。
 */
export function coverPreviewBackground(input: {
  pageBackground?: string;
  /** 第三套派定的配色 id;认不出来就当没有。 */
  coverColorway?: string | null;
}): string | undefined {
  const colorway = coverColorwayById(input.coverColorway);
  return colorway?.bg ?? input.pageBackground;
}

/** 回执卡需要的页面切片(画板 state 与 draft 骨架都能喂进来的最小交集)。 */
export type RecapSourcePage = {
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
  htmlJson?: string;
  kind: string;
};

export type CoverRecapData = {
  coverTemplateId: string | null;
  coverPhotoId: string | null;
  endingTemplateId: string | null;
  endingPhotoId: string | null;
  coverTexts?: Record<string, string>;
  endingTexts?: Record<string, string>;
  pageBackground?: string;
};

/** 从已落库页面的页根 style 读回书页底色(成稿时刷进去的那一个,深色套即 colorway 底色)。 */
function backgroundOfPage(page: RecapSourcePage | null): string | undefined {
  const html = page?.htmlJson;
  if (typeof html !== 'string') return undefined;
  const root = /<[a-z0-9]+\b[^>]*\bdata-template="[^"]*"[^>]*>/i.exec(html)?.[0] ?? '';
  return /background-color:\s*(#[0-9a-fA-F]{6})/i.exec(root)?.[1];
}

/**
 * 从真页面组回执卡数据:模板/照片照旧,**文案取页面 textsJson**。
 * 不传文案时 coverOptionHTML 会渲模板 sample —— 用户会在「已选的封面」卡上看到
 * mag-01 的 "NORWAY / Record",而不是 AI 给他写的书名。成稿完成后和刷新回放都要
 * 走这里。cover/ending 任一存在即出卡(老书可能只有其中一页)。
 */
export function coverRecapFromPages(
  pages: readonly RecapSourcePage[] | null | undefined,
): CoverRecapData | null {
  const cover = pages?.find((p) => p.kind === 'cover') ?? null;
  const ending = pages?.find((p) => p.kind === 'ending') ?? null;
  if (!cover && !ending) return null;
  const photoOf = (page: RecapSourcePage | null): string | null =>
    page ? (Object.values(page.imagesJson)[0] ?? null) : null;
  const background = backgroundOfPage(cover) ?? backgroundOfPage(ending);
  return {
    coverTemplateId: cover?.templateId ?? null,
    coverPhotoId: photoOf(cover),
    endingTemplateId: ending?.templateId ?? null,
    endingPhotoId: photoOf(ending),
    ...(cover ? { coverTexts: cover.textsJson } : {}),
    ...(ending ? { endingTexts: ending.textsJson } : {}),
    ...(background ? { pageBackground: background } : {}),
  };
}
