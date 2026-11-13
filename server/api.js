import { sourceSignature } from "./git.js";
import { cycleRoute, publicWorkspace } from "./cycle-api.js";
import { fileURLToPath } from "node:url";
import { WorkspaceStore } from "./workspace.js";
import {
  readPreviewFile,
  readMarkdownImage,
  extractWordText,
} from "./files.js";
import { readDirectory } from "./directories.js";

function reply(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}
async function readJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Use application/json for this request.");
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 1024 * 1024)
      throw new Error("Request is too large.");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
}
export function createApi({
  store = new WorkspaceStore(),
  defaultPath = process.cwd(),
} = {}) {
  const ready = store.acquire().then(() => store.restore());
  ready.catch(() => {});
  let clients = 0,
    timer,
    scanning = false,
    signature = "",
    lastFull = 0,
    nextScan = 0;
  async function scan() {
    if (scanning || !clients || !store.snapshot() || Date.now() < nextScan)
      return;
    scanning = true;
    const started = Date.now();
    try {
      const current = store.snapshot(),
        next = await sourceSignature(current);
      if (next !== signature || Date.now() - lastFull >= 60000) {
        await store.capture("detector");
        signature = next;
        lastFull = Date.now();
      }
      nextScan =
        Date.now() +
        Math.min(60000, Math.max(5000, (Date.now() - started) * 2));
    } catch {
      nextScan =
        Date.now() + 30000; /* Manual refresh exposes actionable errors. */
    } finally {
      scanning = false;
    }
  }

  return async (request, response, next) => {
    if (!request.url?.startsWith("/api/")) {
      if (next) return next();
      return reply(response, 404, { error: "Not found." });
    }
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host}`);
    } catch {
      return reply(response, 400, { error: "Invalid request host." });
    }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      return reply(response, 403, { error: "Local requests only." });
    if (request.headers.origin && request.headers.origin !== url.origin)
      return reply(response, 403, {
        error: "Cross-origin access is not allowed.",
      });
    if (request.headers["sec-fetch-site"] === "cross-site")
      return reply(response, 403, {
        error: "Cross-origin access is not allowed.",
      });
    try {
      await ready;
      if (request.method === "GET" && url.pathname === "/api/directories") {
        return reply(
          response,
          200,
          await readDirectory(
            url.searchParams.get("path") || "~",
            url.searchParams.get("showHidden") === "true",
          ),
        );
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        if (response.destroyed) return;
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        const notify = (revision, type = "workspace-updated") =>
          response.write(
            `data: ${JSON.stringify({ revision, type, repositoryId: store.snapshot()?.repositoryId, comparisonId: store.snapshot()?.comparisonId })}\n\n`,
          );
        store.on("revision", notify);
        response.on("close", () => {
          store.off("revision", notify);
          clients--;
          if (!clients) {
            clearInterval(timer);
            timer = undefined;
          }
        });
        clients++;
        if (!timer) {
          nextScan = 0;
          timer = setInterval(scan, 5000);
          timer.unref?.();
        }
        notify(store.revision);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/file") {
        if (request.headers["sec-fetch-site"] === "cross-site")
          return reply(response, 403, {
            error: "Cross-origin access is not allowed.",
          });
        const resource = url.searchParams.get("resource");
        const read = resource === null ? readPreviewFile : readMarkdownImage;
        const requestedVersion = url.searchParams.get("version");
        let authorized;
        try {
          authorized =
            store.snapshot()?.version === requestedVersion
              ? store.snapshot()
              : store.reviews.getSnapshot(
                  store.snapshot()?.repo.path,
                  requestedVersion,
                );
        } catch (error) {
          if (error.status === 404) error.status = 409;
          throw error;
        }
        const file = await read(
          authorized,
          url.searchParams.get("sectionId"),
          url.searchParams.get("version"),
          url.searchParams.get("side") || "after",
          resource,
        );
        let bytes = file.bytes,
          mimeType = file.mimeType;
        if (url.searchParams.get("format") === "text") {
          if (file.kind !== "word-doc")
            return reply(response, 400, {
              error: "Text extraction is only available for DOC files.",
            });
          bytes = Buffer.from(await extractWordText(bytes), "utf8");
          mimeType = "text/plain; charset=utf-8";
        }
        response.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Length": bytes.length,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Content-Security-Policy": "sandbox; default-src 'none'",
        });
        return response.end(bytes);
      }
      if (request.method === "GET" && url.pathname === "/api/workspace") {
        if (url.searchParams.get("since") === String(store.revision))
          return reply(response, 200, {
            revision: store.revision,
            unchanged: true,
          });
        const mcpConfig = {
          mcpServers: {
            ordiff: {
              command: process.execPath,
              args: [fileURLToPath(new URL("./mcp.js", import.meta.url))],
              env: { ORDIFF_URL: url.origin },
            },
          },
        };
        return reply(response, 200, {
          revision: store.revision,
          workspace: publicWorkspace(store.snapshot()),
          recentRepositories: store.recentRepositories,
          defaultPath,
          mcpConfig,
        });
      }
      const cyclePath =
        /^\/api\/(cycle|repositories|comparisons|snapshots|review-passes|comments|feedback-batches|plan-proposals)(\/|$)/.test(
          url.pathname,
        );
      if (cyclePath) {
        const body = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
          ? await readJson(request)
          : {};
        if (
          await cycleRoute(
            store,
            request,
            url,
            body,
            (status, data, headers) => {
              if (headers) {
                response.writeHead(status, headers);
                response.end(data);
              } else reply(response, status, data);
            },
          )
        )
          return;
        return reply(response, 404, { error: "Not found." });
      }
      if (request.method !== "POST")
        return reply(response, 405, { error: "Method not allowed." });
      const body = await readJson(request);
      if (url.pathname === "/api/repository") await store.connect(body.path);
      else if (url.pathname === "/api/recent-repositories/remove")
        await store.removeRecentRepository(body.path);
      else if (url.pathname === "/api/disconnect") await store.disconnect();
      else if (url.pathname === "/api/refresh") await store.refresh();
      else if (url.pathname === "/api/context") {
        const snapshot = body.snapshotId
          ? store.reviews.getSnapshot(
              store.snapshot().repo.path,
              body.snapshotId,
            )
          : await store.capture();
        return reply(response, 200, {
          revision: store.revision,
          workspace: publicWorkspace(
            snapshot.version === store.snapshot().version
              ? store.reviews.decorate(snapshot)
              : snapshot,
          ),
          visibleSnapshotId: store.snapshot().version,
        });
      } else if (url.pathname === "/api/review-plan") {
        const { reviewPlanSchema } = await import("./schema.js");
        await store.submitPlan(reviewPlanSchema.parse(body));
      } else return reply(response, 404, { error: "Not found." });
      return reply(response, 200, {
        revision: store.revision,
        workspace: publicWorkspace(store.snapshot()),
        recentRepositories: store.recentRepositories,
      });
    } catch (error) {
      const message =
        error.name === "ZodError"
          ? "The review plan is not valid. Check its groups, steps, and explanations."
          : error.message;
      return reply(
        response,
        error.status || (/diff changed/.test(message) ? 409 : 400),
        {
          error: message,
          code: error.code || "INVALID_REQUEST",
          message,
          retryable: error.status === 409,
          currentRevision: error.currentRevision,
          current: error.current,
        },
      );
    }
  };
}
