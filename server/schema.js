import * as z from 'zod/v4';

export const reviewPlanSchema = z.object({
  version: z.string().min(1).describe('The exact diff version returned by get_review_context.'),
  groups: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    title: z.string().min(1).max(160).describe('The behavior a human is reviewing.'),
    description: z.string().max(1000),
    steps: z.array(z.object({
      sectionId: z.string().min(1).describe('An existing hunk ID from the current diff; never invent IDs.'),
      explanation: z.string().max(2000).describe('Why this section belongs to the behavior and follows the previous step.'),
    })).min(1).max(500),
  })).min(1).max(100),
});
