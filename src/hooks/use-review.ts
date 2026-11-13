import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cycleRequest } from "../lib/cycle-client";
import * as demo from "../sample-data";
import { createReviewModel } from "../review";
import { useFeedback } from "./use-feedback";
import { isPageHidden } from "../lib/visibility";
import type {
  McpConfig,
  RecentRepository,
  ReviewAction,
  ReviewDataset,
  ReviewState,
  Theme,
  Workspace,
  WorkspaceResponse,
} from "../types";

const empty: ReviewDataset = { version: "empty", groups: [], sections: [] };
type Session = {
  workspace: Workspace | null;
  mode: "none" | "demo" | "git";
  review: ReviewState;
  undo: {
    id: string;
    expiresAt: number;
    decisionRevision?: number;
    previousStatus?: "pending" | "reviewed" | "deferred";
    location: Pick<
      ReviewState,
      "view" | "groupId" | "activeId" | "query" | "filter" | "revisit"
    >;
  } | null;
};
const keyFor = (workspace: Workspace | null, demoMode = false) =>
  `ordiff.review.v2.${demoMode ? "demo" : workspace?.repo.path || "none"}`;
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The local service could not complete the request.";
async function api(
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<WorkspaceResponse> {
  const response = await fetch(
    `/api/${endpoint}`,
    body === undefined
      ? { signal }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
  );
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The local service is unavailable. Reopen Ordiff (or run npm run dev) and try again.",
    );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "The local service could not complete the request.",
    );
  return data;
}
function normalize(
  model: ReturnType<typeof createReviewModel>,
  review: ReviewState,
) {
  const visible = model.getVisibleSections(review);
  return visible.length &&
    !visible.some((section) => section.id === review.activeId)
    ? model.reduceReview(review, { type: "section", id: visible[0].id })
    : review;
}
export function useReview() {
  const [session, setSession] = useState<Session>(() => ({
    workspace: null,
    mode: "none",
    review: createReviewModel(empty).createReview(),
    undo: null,
  }));
  const current = useRef(session);
  current.current = session;
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("ordiff.appearance") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [defaultPath, setDefaultPath] = useState("");
  const [recentRepositories, setRecentRepositories] = useState<
    RecentRepository[]
  >([]);
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revision = useRef(-1);
  const generation = useRef(0);
  const syncConnection = useRef<() => void>(() => {});
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const model = useMemo(
    () => createReviewModel(session.workspace || empty),
    [session.workspace],
  );

  const announce = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const applyWorkspace = useCallback(
    (next: Workspace | null, fromDemo = false) => {
      let saved: unknown;
      try {
        saved = JSON.parse(
          localStorage.getItem(keyFor(next, fromDemo)) || "null",
        );
      } catch {
        /* Invalid or unavailable saves start fresh. */
      }
      setSession((previous) => {
        const nextModel = createReviewModel(next || empty);
        const sameDiff =
          previous.workspace?.version === next?.version &&
          previous.workspace?.repo.path === next?.repo.path;
        const samePass =
          sameDiff &&
          previous.workspace?.cycle?.pass.id === next?.cycle?.pass.id;
        let review = nextModel.createReview(samePass ? previous.review : saved);
        if (next?.cycle) {
          const decisions = next.cycle.pass.decisions;
          review = {
            ...review,
            reviewed: Object.keys(decisions).filter(
              (id) => decisions[id].status === "reviewed",
            ),
            deferred: Object.keys(decisions).filter(
              (id) => decisions[id].status === "deferred",
            ),
            checks: next.cycle.pass.checks,
          };
          if (samePass)
            review = {
              ...review,
              query: previous.review.query,
              filter: previous.review.filter,
              revisit: previous.review.revisit,
              pathFilter: previous.review.pathFilter,
              changeFilter: previous.review.changeFilter,
              feedbackOnly: previous.review.feedbackOnly,
            };
        }
        if (
          (fromDemo &&
            (!saved ||
              (saved as Partial<ReviewState>).version !== next?.version)) ||
          (!previous.workspace?.groups.length &&
            nextModel.groups.length > 0 &&
            sameDiff)
        )
          review = nextModel.reduceReview(review, {
            type: "group",
            id: nextModel.groups[0].id,
          });
        return {
          workspace: next,
          mode: fromDemo ? "demo" : next ? "git" : "none",
          review: normalize(nextModel, review),
          undo: sameDiff ? previous.undo : null,
        };
      });
    },
    [],
  );
  const feedback = useFeedback(
    session.workspace,
    session.review,
    applyWorkspace,
  );
  const mutationQueue = useRef(Promise.resolve());
  async function cycleAction<T = unknown>(
    action: string,
    input: Record<string, unknown> = {},
  ) {
    const workspace = current.current.workspace;
    if (!workspace?.cycle) throw new Error("Open a local repository first.");
    const data = await cycleRequest<T>(workspace, action, input);
    if (current.current.workspace?.comparisonId === workspace.comparisonId) {
      revision.current = data.revision;
      applyWorkspace(data.workspace);
    }
    return data.result;
  }
  function persistDecision(
    id: string,
    status: "pending" | "reviewed" | "deferred",
    expectedRevision?: number,
    note = "",
  ) {
    const workspace = current.current.workspace;
    if (!workspace?.cycle) return;
    const passId = workspace.cycle.pass.id;
    const expected =
      expectedRevision ?? workspace.cycle.pass.decisions[id]?.revision ?? 0;
    mutationQueue.current = mutationQueue.current
      .then(async () => {
        const latest = current.current.workspace;
        if (latest?.cycle?.pass.id !== passId)
          throw new Error(
            "The review pass changed. Please repeat your decision.",
          );
        await cycleAction("decision", {
          passId,
          sectionId: id,
          status,
          expectedRevision: expected,
          note,
        });
      })
      .catch(async (error) => {
        announce(messageOf(error));
        try {
          const data = await api("workspace");
          applyWorkspace(data.workspace);
        } catch {
          /* reconnect will restore server state */
        }
      });
  }
  function deferAndContinue(note = "") {
    const id = current.current.review.activeId;
    if (!id) return;
    persistDecision(id, "deferred", undefined, note);
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      let review = nextModel.reduceReview(previous.review, {
        type: "defer",
        id,
      });
      const next = nextModel.sections.find(
        (s) =>
          s.id !== id &&
          !review.reviewed.includes(s.id) &&
          !review.deferred?.includes(s.id),
      );
      if (next)
        review = nextModel.reduceReview(
          { ...review, view: "all" },
          { type: "section", id: next.id },
        );
      else
        review = {
          ...review,
          view: "deferred",
          activeId: review.deferred?.[0] || id,
        };
      return {
        ...previous,
        review,
        undo: {
          id,
          expiresAt: Date.now() + 6000,
          decisionRevision:
            (previous.workspace?.cycle?.pass.decisions[id]?.revision || 0) + 1,
          previousStatus: previous.review.reviewed.includes(id)
            ? "reviewed"
            : "pending",
          location: {
            view: previous.review.view,
            groupId: previous.review.groupId,
            activeId: previous.review.activeId,
            query: previous.review.query,
            filter: previous.review.filter,
            revisit: previous.review.revisit,
          },
        },
      };
    });
  }
  useEffect(() => {
    if (!session.undo) return;
    const record = session.undo;
    const timer = setTimeout(
      () => {
        setSession((previous) =>
          previous.undo === record ? { ...previous, undo: null } : previous,
        );
      },
      Math.max(0, record.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session.undo]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ordiff.appearance", theme);
      localStorage.setItem(
        keyFor(session.workspace, session.mode === "demo"),
        JSON.stringify({ ...session.review, theme }),
      );
    } catch {
      setStorageAvailable(false);
    }
  }, [session, theme]);
  useEffect(() => {
    let active = true,
      pending = false,
      dirty = false;
    let stream: EventSource | undefined;
    let abort = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    async function load(incremental = false) {
      if (!active || isPageHidden() || current.current.mode === "demo") return;
      if (pending) {
        dirty = true;
        return;
      }
      if (busyRef.current) return;
      pending = true;
      const started = generation.current;
      const signal = abort.signal;
      try {
        const data = await api(
          `workspace${incremental ? `?since=${revision.current}` : ""}`,
          undefined,
          signal,
        );
        if (!active || signal.aborted) return;
        // Connection metadata remains useful even if a newer repository request superseded this snapshot.
        if (data.defaultPath) setDefaultPath(data.defaultPath);
        if (data.mcpConfig) setMcpConfig(data.mcpConfig);
        if (started !== generation.current) return;
        if (data.recentRepositories)
          setRecentRepositories(data.recentRepositories);
        setServiceError("");
        if (data.unchanged) return;
        revision.current = data.revision;
        {
          const previous = current.current.workspace;
          if (
            previous &&
            data.workspace &&
            previous.repo.path === data.workspace.repo.path &&
            previous.version !== data.workspace.version
          )
            announce(
              "Diff updated. Review progress starts fresh for these changes.",
            );
          applyWorkspace(data.workspace);
        }
      } catch (error) {
        if (
          active &&
          !signal.aborted &&
          started === generation.current &&
          !incremental
        )
          setServiceError(messageOf(error));
      } finally {
        pending = false;
        if (dirty && active && !isPageHidden()) {
          dirty = false;
          void load(true);
        }
      }
    }
    function connect() {
      if (
        !active ||
        isPageHidden() ||
        stream ||
        busyRef.current ||
        current.current.mode === "demo"
      )
        return;
      stream = new EventSource("/api/events");
      stream.onmessage = (event) => {
        delay = 1000;
        try {
          const next = JSON.parse(event.data);
          if (
            Number.isInteger(next.revision) &&
            next.revision !== revision.current
          )
            void load(true);
        } catch {
          /* A reconnect always resynchronizes the workspace. */
        }
      };
      stream.onerror = () => {
        stream?.close();
        stream = undefined;
        if (active && !isPageHidden()) {
          retry = setTimeout(() => {
            connect();
            void load();
          }, delay);
          delay = Math.min(delay * 2, 60000);
        }
      };
    }
    function synchronize(resync = false) {
      clearTimeout(retry);
      if (
        isPageHidden() ||
        busyRef.current ||
        current.current.mode === "demo"
      ) {
        stream?.close();
        stream = undefined;
        if (isPageHidden() || current.current.mode === "demo") {
          abort.abort();
          abort = new AbortController();
        }
      } else {
        connect();
        if (resync) void load();
      }
    }
    const visibilityChanged = () => synchronize(true);
    syncConnection.current = () => synchronize();
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("ordiff:visibility", visibilityChanged);
    return () => {
      active = false;
      abort.abort();
      stream?.close();
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("ordiff:visibility", visibilityChanged);
      syncConnection.current = () => {};
    };
  }, [announce, applyWorkspace]);
  useEffect(() => {
    syncConnection.current();
  }, [session.mode, busy]);
  function dispatch(action: ReviewAction) {
    if (action.type === "set-reviewed")
      persistDecision(action.id, action.reviewed ? "reviewed" : "pending");
    if (action.type === "defer") persistDecision(action.id, "deferred");
    if (action.type === "check" && current.current.workspace?.cycle) {
      const next = model.reduceReview(current.current.review, action);
      void cycleAction("checks", {
        passId: current.current.workspace.cycle.pass.id,
        checks: next.checks,
        expectedRevision:
          current.current.workspace.cycle.pass.checksRevision || 0,
      }).catch((error) => announce(messageOf(error)));
    }
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      return {
        ...previous,
        undo: action.type === "set-reviewed" ? null : previous.undo,
        review: normalize(
          nextModel,
          nextModel.reduceReview(previous.review, action),
        ),
      };
    });
  }
  function markAndContinue() {
    const id = current.current.review.activeId;
    if (id && !current.current.review.reviewed.includes(id))
      persistDecision(id, "reviewed");
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      const section = nextModel.getActiveSection(previous.review);
      if (!section) return previous;
      const wasReviewed = previous.review.reviewed.includes(section.id);
      let review = nextModel.reduceReview(previous.review, {
        type: "set-reviewed",
        id: section.id,
        reviewed: true,
      });
      if (nextModel.getReviewStatus(review) !== "complete") {
        const order = [
          ...new Set([
            ...nextModel.guidedOrder,
            ...nextModel.sections.map((item) => item.id),
          ]),
        ];
        const position = order.indexOf(section.id);
        const nextId = [
          ...order.slice(position + 1),
          ...order.slice(0, position),
        ]
          .filter((id) => !review.reviewed.includes(id))
          .sort(
            (a, b) =>
              Number(review.deferred?.includes(a)) -
              Number(review.deferred?.includes(b)),
          )[0];
        if (nextId) {
          const nextSection = nextModel.sectionById[nextId];
          if (review.view === "behavior" && !nextSection.group)
            review = nextModel.reduceReview(review, {
              type: "view",
              view: "ungrouped",
            });
          else if (review.view === "ungrouped" && nextSection.group)
            review = nextModel.reduceReview(review, {
              type: "view",
              view: "all",
            });
          review = nextModel.reduceReview(review, {
            type: "section",
            id: nextId,
          });
          if (
            !nextModel
              .getVisibleSections(review)
              .some((item) => item.id === nextId)
          )
            review = { ...review, query: "", filter: "all" };
        }
      }
      const { view, groupId, activeId, query, filter, revisit } =
        previous.review;
      return {
        ...previous,
        review: normalize(nextModel, review),
        undo: wasReviewed
          ? previous.undo
          : {
              id: section.id,
              expiresAt: Date.now() + 6000,
              decisionRevision:
                (previous.workspace?.cycle?.pass.decisions[section.id]
                  ?.revision || 0) + 1,
              previousStatus: previous.review.deferred?.includes(section.id)
                ? "deferred"
                : "pending",
              location: { view, groupId, activeId, query, filter, revisit },
            },
      };
    });
  }
  function undoLastMark() {
    if (current.current.undo)
      persistDecision(
        current.current.undo.id,
        current.current.undo.previousStatus || "pending",
        current.current.undo.decisionRevision,
      );
    setSession((previous) => {
      if (!previous.undo || previous.undo.expiresAt <= Date.now())
        return { ...previous, undo: null };
      const nextModel = createReviewModel(previous.workspace || empty);
      let review = nextModel.reduceReview(previous.review, {
        type: "set-reviewed",
        id: previous.undo.id,
        reviewed: false,
      });
      if (previous.undo.previousStatus === "deferred")
        review = nextModel.reduceReview(review, {
          type: "defer",
          id: previous.undo.id,
        });
      if (previous.undo.previousStatus === "reviewed")
        review = nextModel.reduceReview(review, {
          type: "set-reviewed",
          id: previous.undo.id,
          reviewed: true,
        });
      review = { ...review, ...previous.undo.location };
      const section = nextModel.sectionById[previous.undo.id];
      if (
        review.view === "behavior" &&
        !nextModel.groupById[review.groupId || ""]?.sections.includes(
          section.id,
        )
      ) {
        review = {
          ...review,
          view: section.group ? "behavior" : "ungrouped",
          groupId: section.group,
        };
      } else if (review.view === "ungrouped" && section.group) {
        review = { ...review, view: "all" };
      }
      if (
        !nextModel
          .getVisibleSections(review)
          .some((item) => item.id === section.id)
      )
        review = { ...review, query: "", filter: "all" };
      return {
        ...previous,
        undo: null,
        review: normalize(nextModel, review),
      };
    });
  }
  async function connectRepository(path: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    try {
      const data = await api("repository", { path: path.trim() });
      revision.current = data.revision;
      if (data.recentRepositories)
        setRecentRepositories(data.recentRepositories);
      applyWorkspace(data.workspace);
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function removeRecentRepository(path: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    try {
      const data = await api("recent-repositories/remove", { path });
      revision.current = data.revision;
      if (data.recentRepositories)
        setRecentRepositories(data.recentRepositories);
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refreshDiff() {
    if (busyRef.current) return;
    if (session.mode === "demo") {
      announce(
        "The sample diff is fixed. Open a local repository for live changes.",
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    try {
      const data = await api("refresh", {});
      revision.current = data.revision;
      if (data.recentRepositories)
        setRecentRepositories(data.recentRepositories);
      const changed =
        current.current.workspace?.version !== data.workspace?.version;
      applyWorkspace(data.workspace);
      announce(
        changed
          ? "Diff updated. Review progress starts fresh for these changes."
          : "You’re looking at the latest working changes.",
      );
    } catch (error) {
      announce(messageOf(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function disconnect(): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    generation.current++;
    try {
      if (session.mode === "git") {
        const data = await api("disconnect", {});
        revision.current = data.revision;
        if (data.recentRepositories)
          setRecentRepositories(data.recentRepositories);
      }
      applyWorkspace(null);
      return true;
    } catch (error) {
      announce(messageOf(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function startDemo() {
    generation.current++;
    applyWorkspace(
      {
        version: demo.DIFF_VERSION,
        groups: demo.groups,
        sections: demo.sections,
        repo: {
          name: "data-platform",
          path: "demo",
          branch: "feature/pipeline-status",
          source: "demo",
        },
        planStatus: "sample",
      },
      true,
    );
  }
  function browse(reviewed: boolean) {
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      const activeId =
        (reviewed
          ? nextModel.sections[0]
          : nextModel.sections.find(
              (section) => !previous.review.reviewed.includes(section.id),
            )
        )?.id || null;
      return {
        ...previous,
        review: {
          ...previous.review,
          view: "all",
          filter: reviewed ? "reviewed" : "unreviewed",
          revisit: true,
          query: "",
          activeId,
        },
      };
    });
  }
  function restart() {
    if (current.current.workspace?.cycle) {
      void cycleAction("pass.restart").catch((error) =>
        announce(messageOf(error)),
      );
      return;
    }
    setSession((previous) => ({
      ...previous,
      undo: null,
      review: createReviewModel(previous.workspace || empty).createReview(),
    }));
  }
  function clearFilters() {
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      return {
        ...previous,
        review: normalize(
          nextModel,
          nextModel.reduceReview(
            {
              ...previous.review,
              query: "",
              filter: "all",
              pathFilter: "",
              changeFilter: "",
              feedbackOnly: false,
            },
            { type: "view", view: "all" },
          ),
        ),
      };
    });
  }
  return {
    ...session,
    state: session.review,
    model,
    feedback,
    theme,
    toggleTheme: () =>
      setTheme((value) => (value === "light" ? "dark" : "light")),
    storageAvailable,
    defaultPath,
    recentRepositories,
    mcpConfig,
    serviceError,
    busy,
    toast,
    announce,
    dispatch,
    markAndContinue,
    deferAndContinue,
    cycleAction,
    applyWorkspace,
    canUndo: !!session.undo,
    undoLastMark,
    connectRepository,
    removeRecentRepository,
    refreshDiff,
    disconnect,
    startDemo,
    browse,
    restart,
    clearFilters,
  };
}
export type ReviewController = ReturnType<typeof useReview>;
