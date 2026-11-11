import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as demo from "../data";
import { createReviewModel } from "../review";
import type {
  McpConfig,
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
      "The local service is unavailable. Run Ordiff with npm run dev and try again.",
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
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revision = useRef(-1);
  const generation = useRef(0);
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
        let review = nextModel.createReview(sameDiff ? previous.review : saved);
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
        };
      });
    },
    [],
  );
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
      pending = false;
    const abort = new AbortController();
    async function load(poll = false) {
      if (pending || busyRef.current) return;
      pending = true;
      const started = generation.current;
      try {
        const data = await api(
          `workspace${poll ? `?since=${revision.current}` : ""}`,
          undefined,
          abort.signal,
        );
        if (!active) return;
        // Connection metadata remains useful even if a newer repository request superseded this snapshot.
        if (data.defaultPath) setDefaultPath(data.defaultPath);
        if (data.mcpConfig) setMcpConfig(data.mcpConfig);
        if (started !== generation.current) return;
        setServiceError("");
        if (data.unchanged) return;
        revision.current = data.revision;
        if (current.current.mode !== "demo" || data.workspace) {
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
        if (active && started === generation.current && !poll)
          setServiceError(messageOf(error));
      } finally {
        pending = false;
      }
    }
    void load();
    const interval = setInterval(() => {
      if (!document.hidden && current.current.mode !== "demo") void load(true);
    }, 2000);
    return () => {
      active = false;
      abort.abort();
      clearInterval(interval);
    };
  }, [announce, applyWorkspace]);
  function dispatch(action: ReviewAction) {
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      return {
        ...previous,
        review: normalize(
          nextModel,
          nextModel.reduceReview(previous.review, action),
        ),
      };
    });
  }
  function markAndContinue() {
    setSession((previous) => {
      const nextModel = createReviewModel(previous.workspace || empty);
      const section = nextModel.getActiveSection(previous.review);
      if (!section) return previous;
      let review = nextModel.reduceReview(previous.review, {
        type: "review",
        id: section.id,
      });
      if (
        !previous.review.reviewed.includes(section.id) &&
        nextModel.getReviewStatus(review) !== "complete"
      ) {
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
        ].find((id) => !review.reviewed.includes(id));
        if (nextId) {
          if (
            review.view === "behavior" &&
            !nextModel.sectionById[nextId].group
          )
            review = nextModel.reduceReview(review, {
              type: "view",
              view: "ungrouped",
            });
          review = nextModel.reduceReview(review, {
            type: "section",
            id: nextId,
          });
          if (review.filter === "reviewed")
            review = { ...review, filter: "all" };
        }
      }
      return { ...previous, review: normalize(nextModel, review) };
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
      applyWorkspace(data.workspace);
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
    setSession((previous) => ({
      ...previous,
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
            { ...previous.review, query: "", filter: "all" },
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
    theme,
    toggleTheme: () =>
      setTheme((value) => (value === "light" ? "dark" : "light")),
    storageAvailable,
    defaultPath,
    mcpConfig,
    serviceError,
    busy,
    toast,
    announce,
    dispatch,
    markAndContinue,
    connectRepository,
    refreshDiff,
    disconnect,
    startDemo,
    browse,
    restart,
    clearFilters,
  };
}
export type ReviewController = ReturnType<typeof useReview>;
