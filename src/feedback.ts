import type {
  DiffSection,
  FeedbackAction,
  FeedbackComment,
  FeedbackSection,
  FeedbackState,
  Workspace,
} from "./types";

export const intentLabels = {
  change: "Change",
  keep: "Keep",
  note: "Note",
} as const;

export function captureSection(
  section: DiffSection,
  version: string,
): FeedbackSection {
  const range = (side: "old" | "new"): [number, number] | undefined => {
    let result: [number, number] | undefined;
    for (const line of section.lines || []) {
      const number = line[side];
      if (number === null) continue;
      result = result
        ? [Math.min(result[0], number), Math.max(result[1], number)]
        : [number, number];
    }
    return result;
  };
  return {
    id: section.id,
    version,
    hunk: section.symbol || section.title || "Changed section",
    oldRange: range("old"),
    newRange: range("new"),
  };
}

function isRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => Number.isInteger(n) && n > 0) &&
    value[0] <= value[1]
  );
}
function isComment(value: unknown): value is FeedbackComment {
  if (!value || typeof value !== "object") return false;
  const item = value as FeedbackComment;
  if (
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.path !== "string" ||
    !item.path ||
    typeof item.text !== "string" ||
    !Object.hasOwn(intentLabels, item.intent)
  )
    return false;
  const anchor = item.section;
  return (
    !anchor ||
    (typeof anchor.id === "string" &&
      typeof anchor.version === "string" &&
      typeof anchor.hunk === "string" &&
      (!anchor.oldRange || isRange(anchor.oldRange)) &&
      (!anchor.newRange || isRange(anchor.newRange)))
  );
}

export function createFeedback(
  saved?: unknown,
  workspace?: Workspace | null,
  notes: Record<string, string> = {},
): FeedbackState {
  if (saved && typeof saved === "object") {
    const source = saved as Partial<FeedbackState>;
    const seen = new Set<string>();
    return {
      general: typeof source.general === "string" ? source.general : "",
      comments: Array.isArray(source.comments)
        ? source.comments.filter((item): item is FeedbackComment => {
            if (!isComment(item) || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          })
        : [],
    };
  }
  return {
    general: "",
    comments: (workspace?.sections || [])
      .filter((section) => notes[section.id]?.trim())
      .map((section) => ({
        id: `legacy-${section.id}`,
        path: section.path,
        text: notes[section.id],
        intent: "note",
        section: captureSection(section, workspace!.version),
      })),
  };
}

export function reduceFeedback(
  state: FeedbackState,
  action: FeedbackAction,
): FeedbackState {
  switch (action.type) {
    case "add":
      return state.comments.some((item) => item.id === action.comment.id)
        ? state
        : { ...state, comments: [...state.comments, action.comment] };
    case "update":
      return {
        ...state,
        comments: state.comments.map((item) =>
          item.id === action.id
            ? {
                ...item,
                ...action.patch,
                status: Object.keys(action.patch).some((key) =>
                  ["text", "intent", "anchor", "section"].includes(key),
                )
                  ? "open"
                  : action.patch.status || item.status,
              }
            : item,
        ),
      };
    case "remove":
      return {
        ...state,
        comments: state.comments.filter((item) => item.id !== action.id),
      };
    case "general":
      return { ...state, general: action.text };
  }
}

export function feedbackFiles(state: FeedbackState) {
  const files = new Map<string, FeedbackComment[]>();
  for (const comment of state.comments) {
    if (!comment.text.trim()) continue;
    const comments = files.get(comment.path) || [];
    comments.push(comment);
    files.set(comment.path, comments);
  }
  return [...files]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, comments]) => ({ path, comments }));
}

export function feedbackStatus(comment: FeedbackComment, workspace: Workspace) {
  if (!workspace.sections.some((section) => section.path === comment.path))
    return "missing-file";
  if (comment.anchor && comment.anchor.snapshotId !== workspace.version) return "stale-section";
  if (
    comment.section &&
    !workspace.sections.some(
      (section) =>
        section.id === comment.section!.id && section.path === comment.path,
    )
  )
    return "stale-section";
  return "current";
}

export function sectionReference(section: FeedbackSection) {
  const range = (value: [number, number]) =>
    `L${value[0]}${value[0] === value[1] ? "" : `–${value[1]}`}`;
  return [
    section.oldRange && `original ${range(section.oldRange)}`,
    section.newRange && `working ${range(section.newRange)}`,
  ]
    .filter(Boolean)
    .join("; ");
}
