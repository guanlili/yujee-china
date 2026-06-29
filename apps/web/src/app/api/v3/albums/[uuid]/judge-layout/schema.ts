import { z } from 'zod';
import { JudgeLayoutUnit, V3Language } from '@yujee/contracts';

// P2 phase 2 request body (docs/agent/contract.md §5.2.1). The browser sends the
// candidate units it rendered, each candidate carrying its thumbnail (data:image/jpeg).
// Single-candidate / un-renderable units carry chosenIndex=0 (and the Agent then takes
// candidate 0). Reuses the contract JudgeLayoutUnit so the per-unit shape stays in lockstep.
export const JudgeLayoutBodySchema = z
  .object({
    requestId: z.string().min(1),
    language: V3Language,
    units: z.array(JudgeLayoutUnit).min(1),
  })
  .strict();
