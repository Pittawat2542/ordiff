import { useEffect, useRef, useState } from "react";
import {
  captureSection,
  createFeedback,
  feedbackFiles,
  reduceFeedback,
} from "../feedback";
import { cycleRequest } from "../lib/cycle-client";
import type {
  DiffSection,
  FeedbackAction,
  FeedbackAnchor,
  FeedbackComment,
  FeedbackState,
  ReviewState,
  Workspace,
} from "../types";
type Patch = Partial<
  Pick<FeedbackComment, "text" | "intent" | "section" | "anchor" | "status">
>;
type Pending = {
  kind: "create" | "update" | "delete" | "general";
  id: string;
  expectedRevision: number;
  generation: number;
  mutationId: string;
  comment?: FeedbackComment;
  patch?: Patch;
  text?: string;
};
type ServerFeedback = FeedbackState & { revision?: number };
const fields = ["text", "intent", "status", "section", "anchor"] as const;
function overlay(
  server: ServerFeedback,
  edits: Map<string, Pending>,
): FeedbackState {
  let value = structuredClone(server);
  for (const edit of edits.values()) {
    if (edit.kind === "general") value.general = edit.text || "";
    else if (edit.kind === "delete")
      value.comments = value.comments.filter((c) => c.id !== edit.id);
    else if (edit.kind === "create" && edit.comment) {
      value.comments = value.comments.filter((c) => c.id !== edit.id);
      value.comments.push(edit.comment);
    } else if (edit.kind === "update") {
      if (!value.comments.some((c) => c.id === edit.id) && edit.comment)
        value.comments.push(edit.comment);
      value.comments = value.comments.map((c) =>
        c.id === edit.id ? { ...c, ...edit.patch } : c,
      );
    }
  }
  return value;
}
export function useFeedback(
  workspace: Workspace | null,
  review: ReviewState,
  applyWorkspace?: (workspace: Workspace | null) => void,
) {
  const records = useRef(new Map<string, FeedbackState>()),
    servers = useRef(new Map<string, ServerFeedback>()),
    outboxes = useRef(new Map<string, Map<string, Pending>>()),
    statuses = useRef(
      new Map<string, { message: string; conflict: boolean }>(),
    );
  const running = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    latest = useRef(workspace);
  latest.current = workspace;
  const [, render] = useState(0),
    [storageAvailable, setStorageAvailable] = useState(true);
  const key = workspace
    ? `ordiff.feedback.v1.${workspace.repo.source === "demo" ? "demo" : workspace.comparisonId || workspace.repo.path}`
    : "";
  const currentKey = useRef(key);
  currentKey.current = key;
  if (key && !records.current.has(key)) {
    let saved: unknown,
      draft: { state?: FeedbackState; edits?: Pending[] } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) || "null");
      draft = JSON.parse(localStorage.getItem(`${key}.draft`) || "null");
    } catch {
      /* use durable server records */
    }
    const server = structuredClone(
      workspace?.cycle?.feedback ||
        createFeedback(saved, workspace, review.notes),
    );
    servers.current.set(key, server);
    const edits = new Map<string, Pending>();
    if (draft?.edits) {
      for (const edit of draft.edits)
        if (
          edit &&
          ["create", "update", "delete", "general"].includes(edit.kind)
        )
          edits.set(edit.id, edit);
    } else if (draft) {
      // Recover early-format drafts conservatively, retaining their captured revisions.
      const recovered = createFeedback(draft);
      for (const comment of recovered.comments) {
        const current = server.comments.find((c) => c.id === comment.id);
        if (JSON.stringify(current) !== JSON.stringify(comment))
          edits.set(comment.id, {
            kind: current ? "update" : "create",
            id: comment.id,
            expectedRevision: comment.revision || 0,
            generation: 1,
            mutationId: crypto.randomUUID(),
            comment,
            patch: Object.fromEntries(
              fields.map((field) => [field, comment[field]]),
            ),
          });
      }
    }
    outboxes.current.set(key, edits);
    records.current.set(key, edits.size ? overlay(server, edits) : server);
    statuses.current.set(key, {
      message: edits.size ? "Recovered unsaved draft — Retry" : "Saved locally",
      conflict: edits.size > 0,
    });
  }
  const state = records.current.get(key) || createFeedback();
  function notify(k: string, message: string, conflict = false) {
    statuses.current.set(k, { message, conflict });
    render((n) => n + 1);
  }
  function save(k: string) {
    try {
      const value = records.current.get(k);
      localStorage.setItem(k, JSON.stringify(value));
      const edits = [...(outboxes.current.get(k)?.values() || [])];
      if (edits.length)
        localStorage.setItem(
          `${k}.draft`,
          JSON.stringify({ state: value, edits }),
        );
      else localStorage.removeItem(`${k}.draft`);
    } catch {
      setStorageAvailable(false);
    }
  }
  useEffect(() => {
    if (!workspace?.cycle || !key) return;
    servers.current.set(key, structuredClone(workspace.cycle.feedback));
    records.current.set(
      key,
      overlay(workspace.cycle.feedback, outboxes.current.get(key)!),
    );
    render((n) => n + 1);
  }, [workspace?.cycle?.feedback, key]);
  useEffect(() => {
    if (!workspace?.cycle || workspace.comparison?.kind !== "working-tree")
      return;
    const marker = `ordiff.imported.${workspace.repositoryId}.${workspace.comparisonId}`;
    try {
      if (localStorage.getItem(marker)) return;
      const saved = JSON.parse(
          localStorage.getItem(`ordiff.feedback.v1.${workspace.repo.path}`) ||
            "null",
        ),
        savedReview = JSON.parse(
          localStorage.getItem(`ordiff.review.v2.${workspace.repo.path}`) ||
            "null",
        );
      let installationId = localStorage.getItem("ordiff.installation");
      if (!installationId) {
        installationId = crypto.randomUUID();
        localStorage.setItem("ordiff.installation", installationId);
      }
      void cycleRequest(workspace, "import", {
        installationId,
        feedback: createFeedback(saved, workspace, savedReview?.notes || {}),
        review: savedReview,
      })
        .then((data) => {
          localStorage.setItem(marker, "true");
          if (latest.current?.comparisonId === workspace.comparisonId)
            applyWorkspace?.(data.workspace);
        })
        .catch((error) => notify(key, error.message, true));
    } catch {
      setStorageAvailable(false);
    }
  }, [workspace?.comparisonId]);
  async function flush() {
    clearTimeout(timer.current);
    const w = latest.current,
      k = currentKey.current,
      edits = outboxes.current.get(k);
    if (!w?.cycle || !edits?.size || running.current) return;
    running.current = true;
    notify(k, "Saving…");
    let failed = false;
    try {
      for (const sent of [...edits.values()].map((e) => structuredClone(e))) {
        let action: string, input: Record<string, unknown>;
        if (sent.kind === "create") {
          action = "comment.create";
          input = { ...sent.comment };
        } else if (sent.kind === "update") {
          action = "comment.update";
          input = {
            id: sent.id,
            expectedRevision: sent.expectedRevision,
            patch: Object.fromEntries(
              Object.entries(sent.patch || {}).map(([field, value]) => [
                field,
                value === undefined ? null : value,
              ]),
            ),
          };
        } else if (sent.kind === "delete") {
          action = "comment.delete";
          input = { id: sent.id, expectedRevision: sent.expectedRevision };
        } else {
          action = "general";
          input = { text: sent.text, expectedRevision: sent.expectedRevision };
        }
        const data = await cycleRequest(w, action, {
          ...input,
          clientMutationId: sent.mutationId,
        });
        const server = data.workspace!.cycle!.feedback;
        servers.current.set(k, server);
        const pending = edits.get(sent.id);
        if (pending?.generation === sent.generation) edits.delete(sent.id);
        else if (pending) {
          pending.expectedRevision =
            sent.kind === "general"
              ? server.revision
              : server.comments.find((c) => c.id === sent.id)?.revision || 0;
          if (pending.kind === "create" && sent.kind === "create") {
            pending.kind = "update";
            pending.patch = Object.fromEntries(
              fields.map((field) => [field, pending.comment?.[field]]),
            );
            delete pending.comment;
          }
        }
        records.current.set(k, overlay(server, edits));
        save(k);
        if (latest.current?.comparisonId === w.comparisonId)
          applyWorkspace?.(data.workspace);
      }
      notify(k, edits.size ? "Saving…" : "Saved locally");
    } catch (error) {
      failed = true;
      try {
        const response = await fetch("/api/workspace");
        const data = await response.json();
        if (response.ok && data.workspace?.comparisonId === w.comparisonId) {
          servers.current.set(k, data.workspace.cycle.feedback);
          if (latest.current?.comparisonId === w.comparisonId)
            applyWorkspace?.(data.workspace);
        }
      } catch {
        /* retain captured revisions until reconnect */
      }
      notify(
        k,
        error instanceof Error ? error.message : "Save failed — Retry",
        true,
      );
    } finally {
      running.current = false;
      render((n) => n + 1);
      if (!failed && outboxes.current.get(currentKey.current)?.size)
        timer.current = setTimeout(() => void flush(), 400);
    }
  }
  function dispatch(action: FeedbackAction) {
    if (!key) return;
    const previous = records.current.get(key)!,
      next = reduceFeedback(previous, action);
    records.current.set(key, next);
    if (workspace?.cycle) {
      const edits = outboxes.current.get(key)!,
        id =
          action.type === "general"
            ? "$general"
            : action.type === "add"
              ? action.comment.id
              : action.id,
        existing = edits.get(id),
        server = servers.current.get(key)!;
      const edit: Pending = {
        kind:
          action.type === "add"
            ? "create"
            : action.type === "remove"
              ? "delete"
              : action.type === "general"
                ? "general"
                : "update",
        id,
        expectedRevision:
          existing?.expectedRevision ??
          (id === "$general"
            ? server.revision || 0
            : previous.comments.find((c) => c.id === id)?.revision || 0),
        generation: (existing?.generation || 0) + 1,
        mutationId: crypto.randomUUID(),
      };
      if (action.type === "add") edit.comment = action.comment;
      else if (action.type === "update") {
        if (existing?.kind === "create") {
          edit.kind = "create";
          edit.comment = next.comments.find((c) => c.id === id)!;
        } else {
          edit.comment = next.comments.find((c) => c.id === id);
          edit.patch = {
            ...existing?.patch,
            ...action.patch,
            ...(fields.some(
              (f) => f !== "status" && Object.hasOwn(action.patch, f),
            )
              ? { status: "open" as const }
              : {}),
          };
        }
      } else if (action.type === "general") edit.text = action.text;
      if (
        action.type === "remove" &&
        existing?.kind === "create" &&
        !running.current
      )
        edits.delete(id);
      else edits.set(id, edit);
      notify(key, "Saving…");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 400);
    } else render((n) => n + 1);
    save(key);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  function add(
    section: DiffSection,
    scope: "file" | "section",
    anchor?: FeedbackAnchor,
  ) {
    const id = crypto.randomUUID();
    dispatch({
      type: "add",
      comment: {
        id,
        path: section.path,
        text: "",
        intent: "change",
        status: "open",
        ...(scope === "section"
          ? { section: captureSection(section, workspace!.version) }
          : {}),
        ...(anchor ? { anchor } : {}),
      },
    });
    return id;
  }
  function setQuickNote(section: DiffSection, text: string) {
    const id = `legacy-${section.id}`;
    if (records.current.get(key)?.comments.some((c) => c.id === id))
      dispatch({ type: "update", id, patch: { text } });
    else
      dispatch({
        type: "add",
        comment: {
          id,
          path: section.path,
          text,
          intent: "note",
          status: "open",
          section: captureSection(section, workspace!.version),
        },
      });
  }
  const files = feedbackFiles(state),
    status = statuses.current.get(key) || {
      message: "Saved locally",
      conflict: false,
    };
  return {
    state,
    files,
    key,
    storageAvailable,
    saveStatus: status.message,
    conflict: status.conflict,
    flush,
    dispatch,
    add,
    setQuickNote,
    count: files.reduce((sum, file) => sum + file.comments.length, 0),
    useLatest: () => {
      const server = servers.current.get(key);
      if (server) {
        outboxes.current.get(key)?.clear();
        records.current.set(key, structuredClone(server));
        save(key);
        notify(key, "Saved locally");
      }
    },
    saveAsCopies: () => {
      const server = servers.current.get(key) || createFeedback(),
        desired = records.current.get(key)!,
        edits = outboxes.current.get(key)!;
      const changedIds = new Set(edits.keys());
      edits.clear();
      records.current.set(key, structuredClone(server));
      for (const c of desired.comments.filter(
        (c) => changedIds.has(c.id) && c.text.trim(),
      ))
        dispatch({
          type: "add",
          comment: {
            ...c,
            id: crypto.randomUUID(),
            revision: undefined,
            status: "open",
          },
        });
      if (changedIds.has("$general"))
        dispatch({
          type: "general",
          text: [server.general, desired.general].filter(Boolean).join("\n\n"),
        });
      void flush();
    },
    update: (id: string, patch: Patch) =>
      dispatch({ type: "update", id, patch }),
    remove: (id: string) => dispatch({ type: "remove", id }),
    setGeneral: (text: string) => dispatch({ type: "general", text }),
  };
}
export type FeedbackController = ReturnType<typeof useFeedback>;
