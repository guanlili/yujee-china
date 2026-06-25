import { z } from 'zod';
import { V3CoverRequest } from '@yujee/contracts';

export const CoverBodySchema = V3CoverRequest.pick({
  language: true,
  coverTemplateId: true,
  endingTemplateId: true,
  coverPhoto: true,
  endingPhoto: true,
  userMessage: true,
  history: true,
})
  .extend({
    coverPhotoId: z.string().min(1).nullable().optional(),
    endingPhotoId: z.string().min(1).nullable().optional(),
  })
  .strict();
