// Pure inspect→adjust orchestration for the draft-period chat turn (#165 Phase 3),
// split out of EditorPort.tsx so the loop — including the 3-round cap and the
// graceful-failure degradations — is unit-testable without a DOM / html2canvas
// (EditorPort.tsx side-effect-imports CSS + the whole React/template tree, which
// doesn't load under `tsx --test`).
//
// The driver owns ONLY the control flow:
//   1. POST /draft-edit.
//   2. While the model returns kind:'inspect': screenshot that page, POST
//      /inspect-render, thread the diagnosis back as the next /draft-edit message
//      so the text model can call adjust_image_position.
//   3. Cap the inspect rounds at `maxInspectRounds` (default 3) — bounds vision
//      spend/latency; never an infinite vision loop.
//   4. Graceful: an inspect-render throw, or an "unable to inspect" diagnosis
//      (null imageId), degrades to a talk result — never hangs.
// Applying the final result (repaint / append reply) stays in EditorPort; the
// driver returns the terminal DraftEditResult and the caller applies it.

import type { DraftEditResult, InspectRenderResult } from '@/lib/album/authoring-client';

export const MAX_INSPECT_ROUNDS = 3;

// Injected so the loop is testable with plain mocks. `onVisionRound` is an
// optional hook fired right before each inspect→render round so the UI can show a
// "thinking" state during the multi-second vision call.
export interface InspectAdjustDeps {
  postDraftEdit: (pageIndex: number, message: string) => Promise<DraftEditResult>;
  capturePageRender: (pageIndex: number) => Promise<string>;
  postInspectRender: (
    pageIndex: number,
    message: string,
    screenshot: string,
  ) => Promise<InspectRenderResult>;
  // Localized fallback copy for the cap / graceful-fail talk messages.
  capReply: string;
  inspectFailReply: string;
  onVisionRound?: (round: number, pageIndex: number) => void;
  maxInspectRounds?: number;
  // Caps the message length sent to the agent (the body schema caps at 500).
  messageMax?: number;
}

// Thrown by deps (e.g. an auth error from postInspectRender / postDraftEdit) must
// propagate so the caller can handle redirects — the driver only degrades the
// inspect-render *path* to talk, it does not swallow auth errors. The caller marks
// auth errors by setting `.isAuthError` (duck-typed) so this module stays free of
// EditorPort's error classes.
function isAuthError(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { isAuthError?: boolean }).isAuthError);
}

export async function runInspectAdjustLoop(
  focusPageIndex: number,
  userMessage: string,
  deps: InspectAdjustDeps,
): Promise<DraftEditResult> {
  const maxRounds = deps.maxInspectRounds ?? MAX_INSPECT_ROUNDS;
  const cap = deps.messageMax ?? 500;
  const slice = (s: string) => s.slice(0, cap);

  let r = await deps.postDraftEdit(focusPageIndex, slice(userMessage));
  let inspectRounds = 0;

  while (r.kind === 'inspect' && r.inspectRequest) {
    if (inspectRounds >= maxRounds) {
      // Converged or stuck — stop spending vision calls and let the user steer.
      return { kind: 'talk', assistantReply: deps.capReply };
    }
    inspectRounds += 1;
    const inspectPage = r.inspectRequest.pageIndex;
    deps.onVisionRound?.(inspectRounds, inspectPage);

    let diagnosisMsg: string;
    try {
      const screenshot = await deps.capturePageRender(inspectPage);
      const ir = await deps.postInspectRender(inspectPage, slice(userMessage), screenshot);
      if (!ir.diagnosis.imageId) {
        // "unable to inspect" → degrade to the inspect reply (a talk), never hang.
        return { kind: 'talk', assistantReply: ir.assistantReply || r.assistantReply };
      }
      const d = ir.diagnosis;
      diagnosisMsg =
        `[inspection of page ${inspectPage}] imageId=${d.imageId}; problem=${d.problem}; ` +
        `suggestedDx=${d.suggestedDx}; suggestedDy=${d.suggestedDy}; ` +
        `suggestedScale=${d.suggestedScale}; confidence=${d.confidence}. ` +
        `Call adjust_image_position to fix it.`;
    } catch (e) {
      if (isAuthError(e)) throw e; // auth errors must surface (redirect to login).
      // Inspect-render/capture failed — never hang; degrade to talk. Log so a
      // silent capture failure (e.g. an html2canvas color/CSS throw) is visible.
      console.error('[inspect→adjust] capture/diagnose failed:', e);
      return { kind: 'talk', assistantReply: deps.inspectFailReply };
    }
    r = await deps.postDraftEdit(focusPageIndex, slice(diagnosisMsg));
  }

  return r;
}
