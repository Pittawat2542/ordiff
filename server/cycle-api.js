import { readPreviewFile } from "./files.js";
import { listRefs, listCommits } from "./git.js";
import { cycleError } from "./review-store.js";
export function publicWorkspace(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    files: snapshot.files?.map(({ beforeText, afterText, ...file }) => ({
      ...file,
      beforeTextAvailable: typeof beforeText === "string",
      afterTextAvailable: typeof afterText === "string",
    })),
  };
}
export async function cycleRoute(store, request, url, body, reply) {
  const path = url.pathname,
    method = request.method;
  const workspace = store.snapshot();
  if (!workspace)
    throw cycleError(409, "NO_REPOSITORY", "Open a repository first.");
  const pagination = () => ({
    offset: Math.max(0, Number(url.searchParams.get("offset")) || 0),
    limit: Math.min(
      500,
      Math.max(1, Number(url.searchParams.get("limit")) || 100),
    ),
  });
  const result = async (action, input = {}) => {
    const value = await store.cycleAction(action, {
      repositoryId: workspace.repositoryId,
      comparisonId: workspace.comparisonId,
      ...input,
    });
    reply(200, {
      result: value,
      revision: store.revision,
      workspace: publicWorkspace(store.snapshot()),
    });
    return true;
  };
  let match;
  if (
    method === "GET" &&
    (match = /^\/api\/repositories\/([^/]+)\/(refs|commits)$/.exec(path))
  ) {
    if (match[1] !== workspace.repositoryId)
      throw cycleError(
        409,
        "REPOSITORY_CHANGED",
        "The selected repository changed.",
      );
    const { offset, limit } = pagination();
    const query = (url.searchParams.get("q") || "").toLowerCase();
    const items =
      match[2] === "refs"
        ? (await listRefs(workspace.repo.path))
            .filter((r) => r.name.toLowerCase().includes(query))
            .slice(offset, offset + limit)
        : await listCommits(
            workspace.repo.path,
            url.searchParams.get("ref") || "HEAD",
            offset,
            limit,
          );
    reply(200, { items, offset, limit });
    return true;
  }
  if (
    method === "GET" &&
    (match =
      /^\/api\/snapshots\/([^/]+)(?:\/files\/([^/]+)\/(text|content))?$/.exec(
        path,
      ))
  ) {
    const snapshot = store.reviews.getSnapshot(workspace.repo.path, match[1]);
    if (!match[2]) {
      const { offset, limit } = pagination();
      reply(200, {
        ...publicWorkspace(snapshot),
        sections: snapshot.sections.slice(offset, offset + limit),
        total: snapshot.sections.length,
      });
      return true;
    }
    const file = snapshot.files.find((f) => f.id === match[2]);
    if (!file)
      throw cycleError(404, "NOT_FOUND", "File not found in this snapshot.");
    const side = url.searchParams.get("side") || "after";
    if (!["before", "after"].includes(side))
      throw cycleError(422, "INVALID_SIDE", "Choose before or after.");
    if (match[3] === "content") {
      let bytes,
        mimeType = "text/plain; charset=utf-8";
      if (typeof file[`${side}Text`] === "string")
        bytes = Buffer.from(file[`${side}Text`]);
      else {
        const section = snapshot.sections.find(
          (s) => s.fileId === file.id && s.file,
        );
        if (!section)
          throw cycleError(
            413,
            "CONTENT_UNAVAILABLE",
            "This revision is unavailable for download.",
          );
        const content = await readPreviewFile(
          snapshot,
          section.id,
          snapshot.version,
          side,
        );
        bytes = content.bytes;
        mimeType = content.mimeType;
      }
      reply(200, bytes, {
        "Content-Type": mimeType,
        "Content-Length": bytes.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split("/").at(-1)).replace(/'/g, "%27")}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      });
      return true;
    }
    const text = file[`${side}Text`];
    if (typeof text !== "string")
      throw cycleError(
        413,
        "TEXT_UNAVAILABLE",
        "Full text is unavailable for this revision. Use its preview or download.",
      );
    const rows = text.split("\n");
    if (rows.at(-1) === "") rows.pop();
    const start = Math.max(1, Number(url.searchParams.get("start")) || 1),
      { limit } = pagination();
    reply(200, {
      snapshotId: snapshot.version,
      fileId: file.id,
      side,
      start,
      totalLines: rows.length,
      lines: rows
        .slice(start - 1, start - 1 + limit)
        .map((text, i) => ({ number: start + i, text })),
    });
    return true;
  }
  if (
    method === "GET" &&
    (match = /^\/api\/comparisons\/([^/]+)\/comments$/.exec(path))
  ) {
    if (match[1] !== workspace.comparisonId)
      throw cycleError(409, "COMPARISON_CHANGED", "The comparison changed.");
    const { offset, limit } = pagination();
    reply(200, {
      items: workspace.cycle.feedback.comments.slice(offset, offset + limit),
      total: workspace.cycle.feedback.comments.length,
    });
    return true;
  }
  if (
    method === "GET" &&
    (match = /^\/api\/feedback-batches(?:\/([^/]+))?$/.exec(path))
  )
    return result(
      match[1] ? "batch.get" : "batch.list",
      match[1] ? { id: match[1] } : {},
    );
  if (
    method === "GET" &&
    (match = /^\/api\/review-passes\/([^/]+)\/changes$/.exec(path))
  )
    return result("pass.changes", { passId: match[1] });
  if (method === "POST" && path === "/api/comparisons") {
    await store.selectComparison(
      body.spec || body,
      body.repositoryId || workspace.repositoryId,
    );
    reply(200, {
      revision: store.revision,
      workspace: publicWorkspace(store.snapshot()),
    });
    return true;
  }
  if (
    method === "POST" &&
    (match = /^\/api\/comparisons\/([^/]+)\/(capture|activate)$/.exec(path))
  ) {
    if (match[1] !== workspace.comparisonId)
      throw cycleError(409, "COMPARISON_CHANGED", "The comparison changed.");
    if (match[2] === "capture") {
      const snapshot = await store.capture();
      reply(200, {
        snapshot: publicWorkspace(snapshot),
        revision: store.revision,
      });
    } else {
      if (body.expectedPassId !== workspace.cycle.pass.id)
        throw cycleError(409, "PASS_CHANGED", "The active pass changed.");
      await store.activateSnapshot(body.snapshotId, body.expectedPassId);
      reply(200, {
        workspace: publicWorkspace(store.snapshot()),
        revision: store.revision,
      });
    }
    return true;
  }
  if (method === "POST" && path === "/api/cycle") {
    if (
      body.repositoryId !== workspace.repositoryId ||
      body.comparisonId !== workspace.comparisonId
    )
      throw cycleError(
        409,
        "WORKSPACE_CHANGED",
        "The review workspace changed. Your draft is kept.",
      );
    return result(body.action, {
      ...body.input,
      comparisonId: body.comparisonId,
    });
  }
  if (method === "POST" && path === "/api/review-passes")
    return result("pass.restart", body);
  if (
    method === "PATCH" &&
    (match = /^\/api\/review-passes\/([^/]+)\/sections\/([^/]+)$/.exec(path))
  )
    return result("decision", {
      ...body,
      passId: match[1],
      sectionId: match[2],
    });
  if (
    method === "POST" &&
    (match = /^\/api\/comparisons\/([^/]+)\/comments$/.exec(path))
  )
    return result("comment.create", { ...body, comparisonId: match[1] });
  if (
    ["PATCH", "DELETE"].includes(method) &&
    (match = /^\/api\/comments\/([^/]+)$/.exec(path))
  )
    return result(method === "PATCH" ? "comment.update" : "comment.delete", {
      ...body,
      id: match[1],
    });
  if (
    method === "PUT" &&
    (match = /^\/api\/comparisons\/([^/]+)\/general-instructions$/.exec(path))
  )
    return result("general", { ...body, comparisonId: match[1] });
  if (method === "POST" && path === "/api/feedback-batches")
    return result("batch.publish", body);
  if (
    method === "POST" &&
    (match = /^\/api\/feedback-batches\/([^/]+)\/(revoke|reports)$/.exec(path))
  )
    return result(match[2] === "revoke" ? "batch.revoke" : "batch.report", {
      ...body,
      id: match[1],
    });
  if (
    method === "PUT" &&
    (match = /^\/api\/review-passes\/([^/]+)\/plan$/.exec(path))
  ) {
    if (match[1] !== workspace.cycle.pass.id)
      throw cycleError(409, "PASS_CHANGED", "The active pass changed.");
    return result("plan.save", body);
  }
  if (method === "POST" && path === "/api/plan-proposals")
    return result("plan.propose", body);
  if (
    method === "POST" &&
    (match = /^\/api\/plan-proposals\/([^/]+)\/(accept|dismiss)$/.exec(path))
  )
    return result(`plan.${match[2]}`, { ...body, id: match[1] });
  return false;
}
