import type { V3LayoutPatchEntry } from '@yujee/contracts';

export type BrowserCoverPatchEntry = {
  pageIndex: number;
  templateId?: string;
  imagesJson?: Record<string, string>;
  textsJson?: Record<string, string>;
};

export function toBrowserCoverPatch(patch: V3LayoutPatchEntry[]): BrowserCoverPatchEntry[] {
  return patch.map((entry) => ({
    pageIndex: entry.pageIndex,
    ...(entry.templateId !== undefined ? { templateId: entry.templateId } : {}),
    ...(entry.images !== undefined ? { imagesJson: entry.images } : {}),
    ...(entry.texts !== undefined ? { textsJson: entry.texts } : {}),
  }));
}
