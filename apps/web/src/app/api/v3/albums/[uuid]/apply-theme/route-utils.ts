import { ERRORS } from '@/lib/api/error-codes';
import { getTemplate } from '@yujee/contracts/templates';
import type {
  Page,
  V3ApplyThemeRequest,
  V3ApplyThemeResponse,
} from '@yujee/contracts';

type ApplyThemeSkeleton = {
  pages: Array<{ pageIndex: number; kind: string; chapterId: string | null }>;
} | null;

export function buildApplyThemeAgentRequests(
  payload: V3ApplyThemeRequest,
  skeleton: ApplyThemeSkeleton,
): V3ApplyThemeRequest[] {
  if (!skeleton) {
    if (payload.chapters.length === 1) return [payload];
    throw ERRORS.VALIDATION_FAILED('album has no V3 draft skeleton');
  }

  const pageByIndex = new Map<number, Page>(payload.pages.map((page) => [page.pageIndex, page]));
  const requests: V3ApplyThemeRequest[] = [];
  for (const choice of payload.chapters) {
    const relatedPages = skeleton.pages
      .filter((page) => page.kind === 'chapter' && page.chapterId === choice.chapterId)
      .map((page) => pageByIndex.get(page.pageIndex))
      .filter((page): page is Page => Boolean(page));

    if (relatedPages.length === 0) {
      throw ERRORS.VALIDATION_FAILED(`no related pages for theme chapter ${choice.chapterId}`);
    }

    const themablePages = relatedPages.filter(hasVariableDecorSlot);
    if (themablePages.length > 0) {
      requests.push({ ...payload, chapters: [choice], pages: themablePages });
    }
  }
  return requests;
}

export function combineApplyThemeResponses(responses: V3ApplyThemeResponse[]): V3ApplyThemeResponse {
  return {
    layoutPatch: responses.flatMap((response) => response.layoutPatch),
    assistantReply: responses.map((response) => response.assistantReply).filter(Boolean).join('\n') || undefined,
    usage: {
      durationMs: responses.reduce((sum, response) => sum + response.usage.durationMs, 0),
      visionCallCount: responses.reduce((sum, response) => sum + response.usage.visionCallCount, 0),
      planningInputTokens: responses.reduce((sum, response) => sum + response.usage.planningInputTokens, 0),
      planningOutputTokens: responses.reduce((sum, response) => sum + response.usage.planningOutputTokens, 0),
      repairAttempts: responses.reduce((sum, response) => sum + response.usage.repairAttempts, 0),
      models: Object.assign({}, ...responses.map((response) => response.usage.models)),
    },
  };
}

function hasVariableDecorSlot(page: Page): boolean {
  const template = getTemplate(page.templateId);
  if (!template) return false;
  if ((template.svgs ?? []).some((slot) => slot.variableDecor)) return true;
  if ((template.texts ?? []).some((slot) => slot.variableDecor)) return true;
  return (template.items?.texts ?? []).some((slot) => slot.variableDecor);
}
