import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { HandoffQueue, planReceipt } from "./handoff-queue.js";
import { readRepository, repositoryRoot } from "./git.js";
import { validateGroups } from "./review-store.js";
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
const dataRoot = process.env.ORDIFF_DATA_DIR;
const inbox = dataRoot && new HandoffQueue(dataRoot);
const checkoutFields = {
  repositoryPath: z
    .string()
    .optional()
    .describe("Absolute path to the intended local checkout."),
  repositoryId: z.string().optional(),
  comparisonId: z.string().optional(),
};
async function request(endpoint, body = {}) {
  let response;
  try {
    response = await fetch(new URL(endpoint, base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (cause) {
    throw Object.assign(
      new Error(
        "Open Ordiff to use this operation. Offline handoffs need repositoryPath and the configuration from Connect agent.",
      ),
      {
        code:
          cause.cause?.code === "ECONNREFUSED" ? "OFFLINE" : "CONNECTION_ERROR",
      },
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Ordiff could not complete the request."),
      { code: data.code },
    );
  return data;
}
async function context(input) {
  try {
    return await request("/api/context", input);
  } catch (error) {
    if (!inbox || !["OFFLINE", "NOT_FOUND"].includes(error.code)) throw error;
    if (input.snapshotId) {
      const cached = inbox.read(input.snapshotId, input.repositoryPath);
      if (cached) return { workspace: cached, visibleSnapshotId: null };
    }
    if (
      error.code !== "OFFLINE" ||
      input.snapshotId ||
      !isAbsolute(input.repositoryPath || "")
    )
      throw error;
    const path = await repositoryRoot(input.repositoryPath);
    let saved;
    try {
      saved = JSON.parse(
        await readFile(join(dataRoot, "workspace.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const entry = saved?.repositories?.find((repo) => repo.path === path);
    if (
      (input.repositoryId && input.repositoryId !== entry?.repositoryId) ||
      (input.comparisonId && input.comparisonId !== entry?.comparisonId)
    )
      throw new Error("Open Ordiff to capture this saved comparison.");
    const comparison =
      entry?.comparison ||
      (saved?.path === path ? saved.comparison : undefined);
    const snapshot = await readRepository(path, comparison);
    inbox.capture(snapshot);
    return { workspace: snapshot, visibleSnapshotId: null };
  }
}
async function sendPlan(version, repositoryPath, groups) {
  const body = { repositoryPath, snapshotId: version, groups };
  const receipt = planReceipt(version, groups);
  try {
    const { result } = await request("/api/agent/plan", body);
    return { result, receipt };
  } catch (error) {
    if (!inbox || !["OFFLINE", "NOT_FOUND"].includes(error.code)) throw error;
    const snapshot = inbox.read(version, repositoryPath);
    if (!snapshot) throw error;
    validateGroups(snapshot, groups);
    inbox.enqueue(snapshot.repo.path, body);
    // If launch raced the enqueue, wake the live importer after the durable commit.
    try {
      const response = await request("/api/handoffs/import", {});
      const failure = response.importErrors.find((e) => e.receipt === receipt);
      if (failure) throw new Error(failure.message);
      const { result } = await request("/api/agent/plan", {
        ...body,
        repositoryPath: snapshot.repo.path,
      });
      return { result, receipt };
    } catch (retryError) {
      if (!["OFFLINE", "CONNECTION_ERROR"].includes(retryError.code))
        throw retryError;
    }
    return { receipt };
  }
}
const feedback = async (action, input) =>
  (await request("/api/agent/feedback", { action, input })).result;
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
  const captures = new Map();
  const server = new McpServer({ name: "ordiff", version: "0.3.1" });
  server.registerTool(
    "get_review_context",
    {
      title: "Read the current review diff",
      description:
        "Pass repositoryPath for your local Git checkout, including when Ordiff is closed. Captures fresh Git contents without activating them in the human review. Returns the exact diff version and hunk IDs. Request includeDiff to read code, optionally limited to sectionIds. Use those IDs to propose a behavior-based reading order. This tool does not mark anything reviewed.",
      inputSchema: z.object({
        ...checkoutFields,
        snapshotId: z.string().optional(),
        includeDiff: z.boolean().default(false),
        includePlan: z.boolean().default(false),
        sectionIds: z.array(z.string()).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async ({ includeDiff, includePlan, sectionIds, ...target }) => {
      if (target.snapshotId && !target.repositoryPath && !target.repositoryId)
        target.repositoryPath =
          captures.get(target.snapshotId) || inbox?.pathFor(target.snapshotId);
      const response = await context(target);
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
        captureRef: {
          repositoryPath: snapshot.repo.path,
          snapshotId: snapshot.version,
        },
        version: snapshot.version,
        snapshotId: snapshot.version,
        repositoryId: snapshot.repositoryId,
        comparisonId: snapshot.comparisonId,
        resolved: snapshot.resolved,
        visibleSnapshotId: response.visibleSnapshotId,
        reviewingOlderSnapshot:
          !!response.visibleSnapshotId &&
          response.visibleSnapshotId !== snapshot.version,
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
      captures.set(snapshot.version, snapshot.repo.path);
      if (captures.size > 100) captures.delete(captures.keys().next().value);
      return data;
    }),
  );
  server.registerTool(
    "submit_review_plan",
    {
      title: "Propose a behavior-based review path",
      description:
        "Send ordered groups for the exact captureRef from get_review_context. With Ordiff closed, the local adapter queues the handoff and returns a receipt. Replacement plans require human acceptance. Uncovered hunks stay visible as unassigned. A hunk may appear in more than one behavior. Does not edit Git files, stage, commit, approve, or mark code reviewed.",
      inputSchema: mcpReviewPlanSchema.extend({
        version: mcpReviewPlanSchema.shape.version.optional(),
        repositoryPath: checkoutFields.repositoryPath,
        captureRef: z
          .object({ repositoryPath: z.string(), snapshotId: z.string() })
          .optional(),
      }),
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
      const version = plan.captureRef?.snapshotId || plan.version;
      if (!version)
        throw new Error(
          "Pass the captureRef or version returned by get_review_context.",
        );
      if (
        plan.captureRef &&
        ((plan.version && plan.captureRef.snapshotId !== plan.version) ||
          (plan.repositoryPath &&
            plan.repositoryPath !== plan.captureRef.repositoryPath))
      )
        throw new Error(
          "Use the exact capture reference returned by get_review_context.",
        );
      const groups = plan.groups.map((group, index) => ({
        id: `behavior-${index + 1}`,
        title: group.title,
        description: group.description || "",
        sections: group.sections,
        explanations: group.explanations || {},
      }));
      const { result: proposal, receipt } = await sendPlan(
        version,
        plan.captureRef?.repositoryPath ||
          plan.repositoryPath ||
          captures.get(version),
        groups,
      );
      if (!proposal)
        return {
          version,
          receipt,
          status: "queued",
          message: "Queued for next launch",
        };
      return {
        version,
        receipt,
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
            ? "The review path is ready in its checkout."
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
        ...checkoutFields,
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async ({ offset, limit, ...target }) => {
      const batches = await feedback("batch.list", target);
      return {
        batches: batches.slice(offset, offset + limit),
        total: batches.length,
      };
    }),
  );
  server.registerTool(
    "get_feedback_batch",
    {
      title: "Read a published feedback batch",
      description:
        "Read an immutable user-published batch with captured source references. Later comment edits do not change this batch.",
      inputSchema: z.object({ ...checkoutFields, batchId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool(async ({ batchId, ...target }) => {
      const batch = await feedback("batch.get", { ...target, id: batchId });
      if (Buffer.byteLength(JSON.stringify(batch)) > 2 * 1024 * 1024)
        throw new Error(
          "This batch is too large. Ask the user to publish a smaller selection.",
        );
      return batch;
    }),
  );
  server.registerTool(
    "report_feedback_outcomes",
    {
      title: "Report attempted feedback outcomes",
      description:
        "Report what was addressed in a published batch. Reports never resolve feedback or mark sections reviewed; the human verifies the result.",
      inputSchema: z.object({
        ...checkoutFields,
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
    tool(async ({ batchId, ...body }) =>
      feedback("batch.report", { ...body, id: batchId }),
    ),
  );
  return server;
});
