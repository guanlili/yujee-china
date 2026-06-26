import { z } from 'zod';
import { V3AnalyzeImageDataUrl, V3Language } from '@yujee/contracts';

const BrowserRefs = z.union([
  z.record(z.string().min(1), V3AnalyzeImageDataUrl),
  z.array(
    z
      .object({
        photoId: z.string().min(1),
        ref200px: V3AnalyzeImageDataUrl,
      })
      .strict(),
  ),
]);

export const SelectLayoutBodySchema = z
  .object({
    requestId: z.string().min(1),
    language: V3Language,
    refs: BrowserRefs,
  })
  .strict();
