import * as z from "zod/v4";
export const comparisonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("working-tree") }),
  z.object({
    kind: z.literal("branch"),
    baseRef: z.string().trim().min(1).max(512),
    headRef: z.string().trim().min(1).max(512),
  }),
  z.object({
    kind: z.literal("commits"),
    beforeRef: z.string().trim().min(1).max(512),
    afterRef: z.string().trim().min(1).max(512),
  }),
]);
export const anchorSchema = z
  .object({
    snapshotId: z.string(),
    fileId: z.string(),
    path: z.string(),
    sectionId: z.string().optional(),
    side: z.enum(["before", "after"]).optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    quote: z.string().max(16384).optional(),
    contextBefore: z.string().max(2000).optional(),
    contextAfter: z.string().max(2000).optional(),
  })
  .refine(
    (a) =>
      a.startLine === undefined ||
      (a.endLine >= a.startLine && a.endLine - a.startLine < 100),
    "Select at most 100 lines on one side.",
  );
export const commentInputSchema = z.object({
  id: z.string().max(160).optional(),
  path: z.string().min(1).max(4096),
  text: z.string().max(50000),
  intent: z.enum(["change", "keep", "note"]),
  anchor: anchorSchema.optional(),
  section: z
    .object({
      id: z.string(),
      version: z.string(),
      hunk: z.string(),
      oldRange: z.tuple([z.number(), z.number()]).optional(),
      newRange: z.tuple([z.number(), z.number()]).optional(),
    })
    .optional(),
});
export const commentPatchSchema = commentInputSchema
  .omit({ id: true, path: true })
  .partial()
  .extend({
    status: z.enum(["open", "addressed", "resolved"]).optional(),
    anchor: anchorSchema.nullable().optional(),
    section: commentInputSchema.shape.section.unwrap().nullable().optional(),
  });
export const groupSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(""),
  sections: z.array(z.string()).max(500),
  explanations: z.record(z.string(), z.string().max(2000)).default({}),
});
export const groupsSchema = z.array(groupSchema).max(100);
export const outcomeSchema = z.object({
  commentId: z.string(),
  outcome: z.enum(["addressed", "not-addressed", "needs-clarification"]),
  explanation: z.string().max(4000),
  sectionIds: z.array(z.string()).max(100).optional(),
});

export const decisionSchema = z.object({
  status: z.enum(["pending", "reviewed", "deferred"]),
  revision: z.number().int().nonnegative(),
  note: z.string().max(2000).optional(),
  updatedAt: z.string().optional(),
});
export const feedbackCommentSchema = commentInputSchema.extend({
  id: z.string().min(1),
  status: z.enum(["open", "addressed", "resolved"]).optional(),
  revision: z.number().int().positive().optional(),
  originalAnchor: anchorSchema.optional(),
});
export const fileSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("git-blob"),
    oid: z.string(),
    commitOid: z.string(),
  }),
  z.object({ kind: z.literal("captured-text"), contentHash: z.string() }),
  z.object({ kind: z.literal("working-file"), contentHash: z.string() }),
  z.object({ kind: z.literal("absent") }),
]);
