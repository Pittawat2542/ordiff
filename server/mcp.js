import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { mcpReviewPlanSchema } from "./schema.js";

const base = new URL(process.env.ORDIFF_URL || "http://127.0.0.1:5173");
if (
  base.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
)
  throw new Error("ORDIFF_URL must point to the local Ordiff server.");
async function request(endpoint, body = {}, full = false, method = "POST") {
  let response;
  try {
    response = await fetch(new URL(endpoint, base), {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(
      "Ordiff is not reachable. Open Ordiff (or run npm run dev), then open a repository in the app.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Ordiff could not complete the request.");
  return full ? data : data.workspace;
}
const result = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});
function tool(handler) {
  return async (input) => {
    try {
      return result(await handler(input));
    } catch (error) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }
  };
}

serveStdio(() => {
  const server = new McpServer({ name: "ordiff", version: "0.3.0" });
  server.registerTool(
    "get_review_context",
    {
      title: "Read the current review diff",
      description:
        "Read the local repository selected by the human in Ordiff. Captures fresh Git contents without activating them in the human review. Returns the exact diff version and hunk IDs. Request includeDiff to read code, optionally limited to sectionIds. Use those IDs to propose a behavior-based reading order. This tool does not mark anything reviewed.",
      inputSchema: z.object({
        snapshotId: z.string().optional(),
        includeDiff: z.boolean().default(false),
        includePlan: z.boolean().default(false),
        sectionIds: z.array(z.string()).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async ({ includeDiff, includePlan, sectionIds, snapshotId }) => {
      const response = await request("/api/context", { snapshotId }, true);
      const snapshot = response.workspace;
      const selected = sectionIds
        ? snapshot.sections.filter((section) => sectionIds.includes(section.id))
        : snapshot.sections;
      if (
        sectionIds?.some((id) => !selected.some((section) => section.id === id))
      )
        throw new Error(
          "A requested section is no longer in this diff. Read the current context again.",
        );
      const data = {
        repo: snapshot.repo.path,
        version: snapshot.version,
        snapshotId: snapshot.version,
        repositoryId: snapshot.repositoryId,
        comparisonId: snapshot.comparisonId,
        resolved: snapshot.resolved,
        visibleSnapshotId: response.visibleSnapshotId,
        reviewingOlderSnapshot: response.visibleSnapshotId !== snapshot.version,
        sections: selected.map((section) => ({
          id: section.id,
          path: section.path,
          hunk: section.symbol,
          ...(section.binary ? { binary: true } : {}),
          ...(includeDiff ? { lines: section.lines } : {}),
        })),
        ...(includePlan
          ? {
              planStatus: snapshot.planStatus,
              groups: snapshot.groups.map((group) => ({
                title: group.title,
                sections: group.sections,
                ...(group.description
                  ? { description: group.description }
                  : {}),
                ...(Object.values(group.explanations || {}).some(Boolean)
                  ? {
                      explanations: Object.fromEntries(
                        Object.entries(group.explanations).filter(
                          ([, value]) => value,
                        ),
                      ),
                    }
                  : {}),
              })),
            }
          : {}),
      };
      if (Buffer.byteLength(JSON.stringify(data)) > 2 * 1024 * 1024)
        throw new Error(
          "This diff is too large for one result. Read the section metadata, then request code for a smaller set of sectionIds.",
        );
      return data;
    }),
  );
  server.registerTool(
    "submit_review_plan",
    {
      title: "Propose a behavior-based review path",
      description:
        "Send ordered behavior groups and grounded step explanations to the open Ordiff app. The version must identify the snapshot returned by get_review_context. Replacement plans require human acceptance. Uncovered hunks stay visible as unassigned. A hunk may appear in more than one behavior. Does not edit Git files, stage, commit, approve, or mark code reviewed.",
      inputSchema: mcpReviewPlanSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    tool(async (plan) => {
      for (const group of plan.groups) {
        if (
          Object.keys(group.explanations || {}).some(
            (id) => !group.sections.includes(id),
          )
        ) {
          throw new Error(
            "Explanations must reference sections in their behavior.",
          );
        }
      }
      const response = await request(
        "/api/plan-proposals",
        {
          snapshotId: plan.version,
          clientMutationId: `plan-${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`,
          groups: plan.groups.map((group, index) => ({
            id: `behavior-${index + 1}`,
            title: group.title,
            description: group.description || "",
            sections: group.sections,
            explanations: group.explanations || {},
          })),
        },
        true,
      );
      const proposal = response.result;
      return {
        version: plan.version,
        proposalId: proposal.id,
        status:
          proposal.status === "accepted"
            ? "accepted"
            : "pending-human-acceptance",
        behaviors: proposal.groups.length,
        coveredSections: new Set(proposal.groups.flatMap((g) => g.sections))
          .size,
        message:
          proposal.status === "accepted"
            ? "The review path is now visible in Ordiff."
            : "The proposed reading path awaits human acceptance in Ordiff.",
      };
    }),
  );
  server.registerTool(
    "list_feedback_batches",
    {
      title: "List published feedback batches",
      description:
        "List explicitly published, non-revoked batches for the selected local comparison. Does not expose unpublished drafts.",
      inputSchema: z.object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async ({ offset, limit }) => {
      const data = await request("/api/feedback-batches", {}, true, "GET");
      return {
        batches: data.result.slice(offset, offset + limit),
        total: data.result.length,
      };
    }),
  );
  server.registerTool(
    "get_feedback_batch",
    {
      title: "Read a published feedback batch",
      description:
        "Read an immutable user-published batch with captured source references. Later comment edits do not change this batch.",
      inputSchema: z.object({ batchId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async ({ batchId }) => {
      const data = await request(
        `/api/feedback-batches/${encodeURIComponent(batchId)}`,
        {},
        true,
        "GET",
      );
      if (Buffer.byteLength(JSON.stringify(data.result)) > 2 * 1024 * 1024)
        throw new Error(
          "This batch is too large. Ask the user to publish a smaller selection.",
        );
      return data.result;
    }),
  );
  server.registerTool(
    "report_feedback_outcomes",
    {
      title: "Report attempted feedback outcomes",
      description:
        "Report what was addressed in a published batch. Reports never resolve feedback or mark sections reviewed; the human verifies the result.",
      inputSchema: z.object({
        batchId: z.string(),
        snapshotId: z.string(),
        clientMutationId: z.string().min(1).max(160),
        outcomes: z
          .array(
            z.object({
              commentId: z.string(),
              outcome: z.enum([
                "addressed",
                "not-addressed",
                "needs-clarification",
              ]),
              explanation: z.string().max(4000),
              sectionIds: z.array(z.string()).max(100).optional(),
            }),
          )
          .max(100),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    tool(
      async ({ batchId, ...body }) =>
        (
          await request(
            `/api/feedback-batches/${encodeURIComponent(batchId)}/reports`,
            body,
            true,
          )
        ).result,
    ),
  );
  return server;
});
